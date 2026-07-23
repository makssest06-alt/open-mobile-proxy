import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID or string id
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  balance: integer('balance').notNull().default(0), // Can store cents
});

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('offline'),
  lastSeen: integer('last_seen', { mode: 'timestamp' }), // UNIX timestamp mapped to Date
  currentIp: text('current_ip'),
  apiKey: text('api_key'),
  battery: integer('battery'),
  autoRotateEnabled: integer('auto_rotate_enabled', { mode: 'boolean' }),
  autoRotateInterval: integer('auto_rotate_interval'),
  lastRotated: integer('last_rotated', { mode: 'timestamp' }),
});

export const proxies = sqliteTable('proxies', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').references(() => devices.id).notNull(),
  login: text('login').notNull(),
  password: text('password').notNull(),
  port: integer('port').notNull().unique(),
  protocol: text('protocol').notNull().default('socks5'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
});

export const trafficLogs = sqliteTable('traffic_logs', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').references(() => devices.id).notNull(),
  bytesIn: integer('bytes_in').notNull().default(0),
  bytesOut: integer('bytes_out').notNull().default(0),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
});
