import { Module } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { HealthController } from './http/health.controller';
import { AuthController } from './auth/auth.controller';
import { SettingsController } from './settings/settings.controller';
import { AdminController } from './agents/admin.controller';
import { AgentPortalController } from './agents/agent-portal.controller';
import {
  AGENTS_SERVICE,
  ASSIGNMENTS_SERVICE,
  AUDIT_SERVICE,
  AUTH_SERVICE,
  CARDS_SERVICE,
  LEDGER_SERVICE,
  MASTER_KEY,
  SETTINGS_SERVICE,
  SQLITE,
  SYNC_SERVICE,
  USER_REPOSITORY,
} from './app.tokens';
import { openDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { AuthService } from './auth/auth.service';
import { DbSessionStore } from './auth/db-session.store';
import { UserRepository } from './auth/user.repository';
import { AuditService } from './audit/audit.service';
import { LedgerService } from './wallet/ledger';
import { SettingsService } from './settings/settings.service';
import { createMainServiceClient } from './remote/main-service-client';
import { SyncService } from './sync/sync.service';
import { AgentsService } from './agents/agents.service';
import { AssignmentsService } from './assignments/assignments.service';
import { CardsService } from './cards/cards.service';
import { resolveMasterKey } from './common/crypto';
import { hashPassword } from './auth/password';

const { sqlite, db } = openDatabase();
runMigrations(sqlite);

const masterKey = resolveMasterKey(process.env.PLUGIN_MASTER_KEY);
const userRepository = new UserRepository(sqlite);
const sessionStore = new DbSessionStore(sqlite);
const authService = new AuthService(
  (username) => userRepository.findByUsername(username),
  { sessionStore },
);
const auditService = new AuditService(sqlite);
const ledgerService = new LedgerService(sqlite);
const settingsService = new SettingsService(sqlite, masterKey, createMainServiceClient);
const syncService = new SyncService(sqlite, settingsService);
const agentsService = new AgentsService(sqlite, ledgerService, userRepository);
const assignmentsService = new AssignmentsService(sqlite);
const cardsService = new CardsService(sqlite, ledgerService);

async function bootstrapAdmin() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password || !password.trim()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('生产环境必须设置 BOOTSTRAP_ADMIN_PASSWORD');
    }
    // ha-min: 开发默认口令，生产已上方拒绝
    // eslint-disable-next-line no-console
    console.warn(
      '[bootstrap] BOOTSTRAP_ADMIN_PASSWORD 未设置，开发环境使用临时口令 change-this-password',
    );
  }
  const resolvedPassword = password?.trim() || 'change-this-password';
  if (!userRepository.findByUsername(username)) {
    await userRepository.createUser({
      username,
      password: resolvedPassword,
      role: 'ADMIN',
      status: 'ACTIVE',
    });
  }
}

void bootstrapAdmin();

@Module({
  controllers: [
    HealthController,
    AuthController,
    SettingsController,
    AdminController,
    AgentPortalController,
  ],
  providers: [
    { provide: SQLITE, useValue: sqlite },
    { provide: MASTER_KEY, useValue: masterKey },
    { provide: USER_REPOSITORY, useValue: userRepository },
    { provide: AUTH_SERVICE, useValue: authService },
    { provide: AUDIT_SERVICE, useValue: auditService },
    { provide: LEDGER_SERVICE, useValue: ledgerService },
    { provide: SETTINGS_SERVICE, useValue: settingsService },
    { provide: SYNC_SERVICE, useValue: syncService },
    { provide: AGENTS_SERVICE, useValue: agentsService },
    { provide: ASSIGNMENTS_SERVICE, useValue: assignmentsService },
    { provide: CARDS_SERVICE, useValue: cardsService },
  ],
  exports: [
    SQLITE,
    AUTH_SERVICE,
    AUDIT_SERVICE,
    LEDGER_SERVICE,
    SETTINGS_SERVICE,
    SYNC_SERVICE,
    AGENTS_SERVICE,
    ASSIGNMENTS_SERVICE,
    CARDS_SERVICE,
  ],
})
export class AppModule {
  static sqlite: Database.Database = sqlite;
  static db = db;
}

// silence unused hashPassword if bootstrap path changes
void hashPassword;
