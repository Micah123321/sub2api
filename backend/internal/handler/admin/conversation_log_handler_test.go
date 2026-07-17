package admin

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestRequireConversationLogAdminSession(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("rejects admin api key", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("auth_method", service.AuditAuthMethodAdminAPIKey)
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
		c.Set(string(middleware.ContextKeyUserRole), service.RoleAdmin)

		require.False(t, requireConversationLogAdminSession(c))
		require.Equal(t, http.StatusForbidden, recorder.Code)
		require.Contains(t, recorder.Body.String(), "CONVERSATION_LOG_SESSION_REQUIRED")
	})

	t.Run("rejects missing jwt subject", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("auth_method", service.AuditAuthMethodJWT)

		require.False(t, requireConversationLogAdminSession(c))
		require.Equal(t, http.StatusUnauthorized, recorder.Code)
	})

	t.Run("accepts administrator jwt session", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("auth_method", service.AuditAuthMethodJWT)
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
		c.Set(string(middleware.ContextKeyUserRole), service.RoleAdmin)

		require.True(t, requireConversationLogAdminSession(c))
		require.Equal(t, http.StatusOK, recorder.Code)
	})
}

func TestConversationLogResponsesDisableCaching(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	setConversationLogNoStore(c)
	require.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
}
