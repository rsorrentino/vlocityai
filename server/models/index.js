const { DataTypes } = require('sequelize');
const databaseService = require('../services/databaseService');

// Initialize sequelize connection
let sequelize = databaseService.getConnection();

// If connection is not available yet, create a temporary one for model definition
if (!sequelize) {
  const { Sequelize } = require('sequelize');
  const path = require('path');
  
  // Use PostgreSQL if DATABASE_URL is provided, otherwise fallback to SQLite
  const databaseUrl = process.env.DATABASE_URL || 
    `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'vlocity_manager'}`;

  // Check if it's a PostgreSQL URL or SQLite fallback
  if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      define: {
        timestamps: true,
        underscored: true,
        freezeTableName: true,
        schema: process.env.DB_SCHEMA || 'vlocity_datapack_manager'
      },
      schema: process.env.DB_SCHEMA || 'vlocity_datapack_manager'
    });
  } else {
    // Fallback to SQLite
    const dbPath = path.join(__dirname, '../../data/vlocity_manager.db');
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: dbPath,
      define: {
        timestamps: true,
        underscored: true,
        freezeTableName: true
      }
    });
  }
}

// User Model
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'developer', 'functional'),
    defaultValue: 'functional',
    allowNull: false
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  lastLogin: {
    type: DataTypes.DATE
  },
  loginAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lockUntil: {
    type: DataTypes.DATE
  },
  preferences: {
    type: DataTypes.JSONB,
    defaultValue: {
      theme: 'light',
      language: 'en',
      notifications: true,
      defaultEnvironment: 'dev'
    }
  },
  permissions: {
    type: DataTypes.JSONB,
    defaultValue: []
  }
}, {
  tableName: 'users',
  hooks: {
    beforeSave: async (user) => {
      if (user.changed('role')) {
        user.permissions = getUserRolePermissions(user.role);
      }
    }
  }
});

// Job Model
const Job = sequelize.define('Job', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('export', 'deploy', 'snapshot', 'sfdmu'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'aborted'),
    defaultValue: 'pending'
  },
  progress: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0,
      max: 100
    }
  },
  configuration: {
    type: DataTypes.JSONB,
    allowNull: false
  },
  result: {
    type: DataTypes.JSONB
  },
  error: {
    type: DataTypes.TEXT
  },
  logs: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  // Context information
  username: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Salesforce username used for the job',
    field: 'username'
  },
  filePath: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Path to the job configuration file',
    field: 'file_path'
  },
  projectPath: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Project path for export/deploy operations',
    field: 'project_path'
  },
  sourceUsername: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Source Salesforce username (for deploy jobs)',
    field: 'source_username'
  },
  targetUsername: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Target Salesforce username (for deploy jobs)',
    field: 'target_username'
  },
  environment: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Environment context (dev, uat, prod)',
    field: 'environment'
  },
  cliType: {
    type: DataTypes.ENUM('vlocity', 'sf'),
    defaultValue: 'vlocity',
    allowNull: false,
    comment: 'CLI type used for the job (vlocity or sf)',
    field: 'cli_type'
  },
  startedAt: {
    type: DataTypes.DATE
  },
  completedAt: {
    type: DataTypes.DATE
  },
  duration: {
    type: DataTypes.INTEGER // in milliseconds
  },
  userId: {
    type: DataTypes.UUID,
    references: {
      model: User,
      key: 'id'
    }
  }
}, {
  tableName: 'jobs'
});

// OrgAnalysis Model
const OrgAnalysis = sequelize.define('OrgAnalysis', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  orgUsername: {
    type: DataTypes.STRING,
    allowNull: false
  },
  analysisType: {
    type: DataTypes.ENUM('full', 'metadata', 'limits', 'components'),
    defaultValue: 'full'
  },
  status: {
    type: DataTypes.ENUM('pending', 'running', 'completed', 'failed'),
    defaultValue: 'pending'
  },
  results: {
    type: DataTypes.JSONB
  },
  metadata: {
    type: DataTypes.JSONB
  },
  limits: {
    type: DataTypes.JSONB
  },
  components: {
    type: DataTypes.JSONB
  },
  error: {
    type: DataTypes.TEXT
  },
  startedAt: {
    type: DataTypes.DATE
  },
  completedAt: {
    type: DataTypes.DATE
  },
  duration: {
    type: DataTypes.INTEGER // in milliseconds
  },
  userId: {
    type: DataTypes.UUID,
    references: {
      model: User,
      key: 'id'
    }
  }
}, {
  tableName: 'org_analyses'
});

// Org Model — tracked Salesforce orgs (DB metadata; auth stays with SF CLI)
const Org = sequelize.define('Org', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'Salesforce username (matches SF CLI authenticated org)',
  },
  alias: {
    type: DataTypes.STRING,
    comment: 'SF CLI alias — synced from CLI on each sync',
  },
  label: {
    type: DataTypes.STRING,
    comment: 'User-defined display name (overrides alias in all app dropdowns)',
  },
  instanceUrl: {
    type: DataTypes.STRING,
    field: 'instance_url',
  },
  orgId: {
    type: DataTypes.STRING,
    field: 'org_id',
  },
  isSandbox: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_sandbox',
  },
  isDevHub: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_dev_hub',
  },
  environment: {
    type: DataTypes.STRING,
    comment: 'User-assigned: dev / uat / prod / staging',
  },
  notes: {
    type: DataTypes.TEXT,
  },
  lastTestedAt: {
    type: DataTypes.DATE,
    field: 'last_tested_at',
  },
  lastTestResult: {
    type: DataTypes.ENUM('success', 'failure', 'unknown'),
    defaultValue: 'unknown',
    field: 'last_test_result',
  },
  lastTestMessage: {
    type: DataTypes.STRING,
    field: 'last_test_message',
  },
  connectedStatus: {
    type: DataTypes.STRING,
    field: 'connected_status',
    comment: 'SF CLI connectedStatus value (Connected / RefreshTokenAuthError / etc.)',
  },
}, {
  tableName: 'orgs',
});

// SystemStatus Model
const SystemStatus = sequelize.define('SystemStatus', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  component: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  status: {
    type: DataTypes.ENUM('healthy', 'warning', 'error', 'unknown'),
    defaultValue: 'unknown'
  },
  message: {
    type: DataTypes.TEXT
  },
  metadata: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  lastChecked: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'system_statuses'
});

// Helper function to get role permissions
function getUserRolePermissions(role) {
  const rolePermissions = {
    admin: [
      { resource: 'users', actions: ['read', 'write', 'delete'] },
      { resource: 'jobs', actions: ['read', 'write', 'delete', 'execute'] },
      { resource: 'orgs', actions: ['read', 'write', 'delete'] },
      { resource: 'configs', actions: ['read', 'write', 'delete'] },
      { resource: 'pricing', actions: ['read', 'write', 'delete'] },
      { resource: 'promotions', actions: ['read', 'write', 'delete', 'execute'] },
      { resource: 'system', actions: ['read', 'write'] },
      { resource: 'logs', actions: ['read', 'write', 'delete'] },
      { resource: 'analytics', actions: ['read', 'write'] }
    ],
    developer: [
      { resource: 'jobs', actions: ['read', 'write', 'execute'] },
      { resource: 'orgs', actions: ['read', 'write'] },
      { resource: 'configs', actions: ['read', 'write'] },
      { resource: 'pricing', actions: ['read', 'write'] },
      { resource: 'promotions', actions: ['read', 'write', 'execute'] },
      { resource: 'system', actions: ['read'] },
      { resource: 'logs', actions: ['read'] },
      { resource: 'analytics', actions: ['read'] }
    ],
    functional: [
      { resource: 'jobs', actions: ['read', 'execute'] },
      { resource: 'orgs', actions: ['read'] },
      { resource: 'configs', actions: ['read'] },
      { resource: 'pricing', actions: ['read', 'write'] },
      { resource: 'promotions', actions: ['read', 'write', 'execute'] },
      { resource: 'analytics', actions: ['read'] }
    ]
  };
  
  return rolePermissions[role] || rolePermissions.functional;
}

// Add instance methods to User model
User.prototype.getRolePermissions = function() {
  return getUserRolePermissions(this.role);
};

User.prototype.hasPermission = function(resource, action) {
  if (this.role === 'admin') return true; // Admin has all permissions
  
  const permission = this.permissions.find(p => p.resource === resource);
  return permission && permission.actions.includes(action);
};

User.prototype.incLoginAttempts = async function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < new Date()) {
    return this.update({
      lockUntil: null,
      loginAttempts: 1
    });
  }
  
  const updates = { loginAttempts: this.loginAttempts + 1 };
  
  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && (!this.lockUntil || this.lockUntil < new Date())) {
    updates.lockUntil = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
  }
  
  return this.update(updates);
};

User.prototype.resetLoginAttempts = async function() {
  return this.update({
    loginAttempts: 0,
    lockUntil: null
  });
};

// SfdmuConfig Model — saved named migration configurations
const SfdmuConfig = sequelize.define('SfdmuConfig', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sourceUsername: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'source_username'
  },
  targetUsername: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'target_username'
  },
  objects: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  filePath: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Last disk path where export.json was exported',
    field: 'file_path'
  }
}, {
  tableName: 'sfdmu_configs'
});

// Define associations
User.hasMany(Job, { foreignKey: 'userId', as: 'jobs' });
Job.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(OrgAnalysis, { foreignKey: 'userId', as: 'orgAnalyses' });
OrgAnalysis.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = {
  User,
  Job,
  OrgAnalysis,
  Org,
  SystemStatus,
  SfdmuConfig,
  sequelize
};