package admin

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/conversationlog"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// ConversationLogHandler exposes admin-only compressed conversation history.
type ConversationLogHandler struct {
	service *service.ConversationLogService
}

// NewConversationLogHandler creates the conversation log admin handler.
func NewConversationLogHandler(svc *service.ConversationLogService) *ConversationLogHandler {
	return &ConversationLogHandler{service: svc}
}

func (h *ConversationLogHandler) List(c *gin.Context) {
	setConversationLogNoStore(c)
	page, pageSize := response.ParsePagination(c)
	if pageSize > 100 {
		pageSize = 100
	}
	filter, ok := conversationLogFilter(c)
	if !ok {
		return
	}
	result, err := h.service.List(c.Request.Context(), filter, page, pageSize)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, result)
}

func (h *ConversationLogHandler) Detail(c *gin.Context) {
	if c.GetString("auth_method") == service.AuditAuthMethodAdminAPIKey {
		response.ErrorWithDetails(c, http.StatusForbidden, "Conversation details require an administrator session", "CONVERSATION_LOG_SESSION_REQUIRED", nil)
		return
	}
	id, ok := positiveConversationLogID(c)
	if !ok {
		return
	}
	detail, err := h.service.Detail(c.Request.Context(), id)
	if errors.Is(err, conversationlog.ErrNotFound) {
		response.NotFound(c, "Conversation log not found")
		return
	}
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	setConversationLogNoStore(c)
	middleware.SetAuditExtra(c, map[string]any{"conversation_log_id": id, "action": "view_detail"})
	response.Success(c, detail)
}

func (h *ConversationLogHandler) Runtime(c *gin.Context) {
	setConversationLogNoStore(c)
	response.Success(c, h.service.Runtime())
}

func setConversationLogNoStore(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
}

func (h *ConversationLogHandler) DeletePreview(c *gin.Context) {
	if !requireConversationLogAdminSession(c) {
		return
	}
	var filter conversationlog.Filter
	if err := c.ShouldBindJSON(&filter); err != nil {
		response.BadRequest(c, "Invalid conversation log filters")
		return
	}
	preview, err := h.service.PreviewDelete(c.Request.Context(), filter)
	if err != nil {
		response.BadRequest(c, "A valid explicit time range is required")
		return
	}
	middleware.SetAuditExtra(c, map[string]any{
		"action": "delete_preview", "matched_count": preview.MatchedCount,
		"snapshot_max_id": preview.SnapshotMaxID, "filter_hash": preview.FilterHash,
	})
	response.Success(c, preview)
}

type conversationDeleteRequest struct {
	Filter            conversationlog.Filter `json:"filter" binding:"required"`
	SnapshotMaxID     int64                  `json:"snapshot_max_id" binding:"required"`
	FilterHash        string                 `json:"filter_hash" binding:"required"`
	ConfirmationToken string                 `json:"confirmation_token" binding:"required"`
	Confirm           bool                   `json:"confirm" binding:"required"`
}

func (h *ConversationLogHandler) DeleteByFilter(c *gin.Context) {
	if !requireConversationLogAdminSession(c) {
		return
	}
	var request conversationDeleteRequest
	if err := c.ShouldBindJSON(&request); err != nil || !request.Confirm {
		response.BadRequest(c, "Invalid or expired delete confirmation")
		return
	}
	deleted, err := h.service.DeleteByFilter(c.Request.Context(), request.Filter, request.SnapshotMaxID, request.FilterHash, request.ConfirmationToken)
	if errors.Is(err, service.ErrConversationDeleteConfirmation) {
		response.BadRequest(c, "Invalid or expired delete confirmation")
		return
	}
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	middleware.SetAuditExtra(c, map[string]any{
		"action": "delete_by_filter", "deleted": deleted,
		"snapshot_max_id": request.SnapshotMaxID, "filter_hash": request.FilterHash,
	})
	response.Success(c, gin.H{"deleted": deleted})
}

func requireConversationLogAdminSession(c *gin.Context) bool {
	if c.GetString("auth_method") == service.AuditAuthMethodAdminAPIKey {
		response.ErrorWithDetails(c, http.StatusForbidden, "Conversation log deletion requires an administrator session", "CONVERSATION_LOG_SESSION_REQUIRED", nil)
		return false
	}
	subject, ok := middleware.GetAuthSubjectFromContext(c)
	role, roleOK := middleware.GetUserRoleFromContext(c)
	if !ok || subject.UserID <= 0 || !roleOK || role != service.RoleAdmin || c.GetString("auth_method") != service.AuditAuthMethodJWT {
		response.Unauthorized(c, "Unauthorized")
		return false
	}
	return true
}

func conversationLogFilter(c *gin.Context) (conversationlog.Filter, bool) {
	filter := conversationlog.Filter{
		Provider: c.Query("provider"), Protocol: c.Query("protocol"), Transport: c.Query("transport"),
		Model: c.Query("model"), Status: c.Query("status"), RequestID: c.Query("request_id"), Keyword: c.Query("keyword"),
	}
	for key, target := range map[string]**int64{
		"user_id": &filter.UserID, "api_key_id": &filter.APIKeyID, "group_id": &filter.GroupID, "account_id": &filter.AccountID,
	} {
		value := strings.TrimSpace(c.Query(key))
		if value == "" {
			continue
		}
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id <= 0 {
			response.BadRequest(c, "Invalid "+key)
			return conversationlog.Filter{}, false
		}
		*target = &id
	}
	for key, target := range map[string]**time.Time{"start_at": &filter.StartAt, "end_at": &filter.EndAt} {
		value := strings.TrimSpace(c.Query(key))
		if value == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil {
			response.BadRequest(c, "Invalid "+key)
			return conversationlog.Filter{}, false
		}
		*target = &parsed
	}
	return filter, true
}

func positiveConversationLogID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id <= 0 {
		response.BadRequest(c, "Invalid conversation log id")
		return 0, false
	}
	return id, true
}
