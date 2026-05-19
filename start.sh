#!/bin/bash

# Vlocity DataPack Manager Startup Script
# This script sets up and starts the Vlocity DataPack Manager application

set -e

echo "🚀 Starting Vlocity DataPack Manager Setup..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js >= 18.0.0"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install Node.js >= 18.0.0"
    exit 1
fi

echo "✅ Node.js version $(node -v) detected"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm >= 8.0.0"
    exit 1
fi

echo "✅ npm version $(npm -v) detected"

# Check if Vlocity CLI is available
if ! command -v vlocity &> /dev/null; then
    echo "⚠️  Vlocity CLI not found. Installing..."
    echo "📦 Installing Vlocity CLI globally..."
    npm install -g vlocity
    
    # Verify installation
    if command -v vlocity &> /dev/null; then
        echo "✅ Vlocity CLI installed successfully: $(vlocity --version)"
    else
        echo "❌ Vlocity CLI installation failed. Please install manually:"
        echo "   npm install -g vlocity"
        echo "   Or visit: https://developer.salesforce.com/docs/atlas.en-us.vlocity_cli.meta/vlocity_cli/"
        exit 1
    fi
else
    echo "✅ Vlocity CLI version $(vlocity --version) detected"
fi

# Check if Salesforce CLI is available
if ! command -v sfdx &> /dev/null; then
    echo "⚠️  Salesforce CLI not found. Please install sfdx CLI"
    echo "   Visit: https://developer.salesforce.com/tools/sfdxcli"
else
    echo "✅ Salesforce CLI version $(sfdx --version) detected"
fi

# Check if PostgreSQL is available
if ! command -v psql &> /dev/null; then
    # Check if we're on Windows (Git Bash or WSL)
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ -n "$WINDIR" ]]; then
        echo "⚠️  PostgreSQL client (psql) not found in PATH"
        echo "   If PostgreSQL is installed, add it to your PATH:"
        echo "   C:\\Program Files\\PostgreSQL\\15\\bin"
        echo "   Or use the Windows installer scripts:"
        echo "   .\\install-postgresql-windows.ps1"
    else
        echo "⚠️  PostgreSQL not found. Installing PostgreSQL..."
        
        # Detect OS and install PostgreSQL
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            # Linux installation
            if command -v apt-get &> /dev/null; then
                # Ubuntu/Debian
                sudo apt-get update
                sudo apt-get install -y postgresql postgresql-contrib
            elif command -v yum &> /dev/null; then
                # CentOS/RHEL
                sudo yum install -y postgresql-server postgresql-contrib
                sudo postgresql-setup initdb
            fi
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS installation
            if command -v brew &> /dev/null; then
                brew install postgresql
                brew services start postgresql
            else
                echo "❌ Homebrew not found. Please install PostgreSQL manually:"
                echo "   Visit: https://www.postgresql.org/download/macosx/"
            fi
        else
            echo "❌ Unsupported OS. Please install PostgreSQL manually:"
            echo "   Visit: https://www.postgresql.org/download/"
        fi
    fi
else
    echo "✅ PostgreSQL version $(psql --version) detected"
fi

# Check if Redis is available (optional)
if ! command -v redis-server &> /dev/null; then
    # Check if we're on Windows (Git Bash or WSL)
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ -n "$WINDIR" ]]; then
        echo "⚠️  Redis server not found in PATH"
        echo "   If Redis is installed, add it to your PATH or start Redis manually"
        echo "   Redis is optional - the app will work without it"
    else
        echo "⚠️  Redis not found. Installing Redis (optional for caching)..."
        
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            if command -v apt-get &> /dev/null; then
                sudo apt-get install -y redis-server
            elif command -v yum &> /dev/null; then
                sudo yum install -y redis
            fi
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew &> /dev/null; then
                brew install redis
            fi
        fi
    fi
else
    echo "✅ Redis version $(redis-server --version | head -n1) detected"
fi

# Install backend dependencies
echo "📦 Installing backend dependencies..."
npm install

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd client
npm install
cd ..

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p logs
mkdir -p temp
mkdir -p jobs
mkdir -p uploads

# Check if environments.properties file exists
if [ ! -f environments.properties ]; then
    echo "⚠️  environments.properties file not found."
    echo "📝 Please ensure environments.properties exists with your Salesforce credentials:"
    echo "   - SFDX_USERNAME: Your default Salesforce username"
    echo "   - SOURCE_SFDX_USERNAME: Source org for exports"
    echo "   - TARGET_SFDX_USERNAME: Target org for deployments"
    echo ""
    echo "   Example:"
    echo "   SFDX_USERNAME=your.username@company.com"
    echo "   SOURCE_SFDX_USERNAME=your.username@company.com"
    echo "   TARGET_SFDX_USERNAME=your.target@company.com"
    echo ""
    echo "   After configuring environments.properties, run this script again to start the application."
    exit 0
fi

echo "✅ Environment configuration found in environments.properties"

# Start PostgreSQL and Redis services
echo "🚀 Starting required services..."

# Start PostgreSQL
if command -v psql &> /dev/null; then
    echo "📊 Starting PostgreSQL..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo systemctl start postgresql 2>/dev/null || sudo service postgresql start 2>/dev/null
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew services start postgresql 2>/dev/null
    else
        pg_ctl start -D /usr/local/var/postgres 2>/dev/null || echo "⚠️  Could not start PostgreSQL automatically"
    fi
    sleep 2
    echo "✅ PostgreSQL started"
else
    echo "⚠️  PostgreSQL not available - continuing without database"
fi

# Start Redis (optional)
if command -v redis-server &> /dev/null; then
    echo "🔄 Starting Redis..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo systemctl start redis 2>/dev/null || sudo service redis-server start 2>/dev/null || redis-server --daemonize yes
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew services start redis 2>/dev/null || redis-server --daemonize yes
    else
        redis-server --daemonize yes
    fi
    sleep 1
    echo "✅ Redis started"
else
    echo "⚠️  Redis not available - continuing without caching"
fi

# Start the application
echo "🚀 Starting Vlocity DataPack Manager..."

# Check if we should run in development or production mode
if [ "$1" = "dev" ] || [ "$1" = "development" ]; then
    echo "🔧 Starting in development mode..."
    npm run dev-full
else
    echo "🏭 Building and starting in production mode..."
    npm run build
    npm start
fi
