@echo off
REM Vlocity DataPack Manager Startup Script for Windows
REM This script sets up and starts the Vlocity DataPack Manager application

echo 🚀 Starting Vlocity DataPack Manager Setup...

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js ^>= 20.9.0
    pause
    exit /b 1
)

echo ✅ Node.js version detected

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm ^>= 8.0.0
    pause
    exit /b 1
)

echo ✅ npm version detected

REM Check if Vlocity CLI is available
vlocity --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  Vlocity CLI not found. Installing...
    npm install -g vlocity
) else (
    echo ✅ Vlocity CLI detected
)

REM Check if Salesforce CLI is available
sfdx --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  Salesforce CLI not found. Please install sfdx CLI
    echo    Visit: https://developer.salesforce.com/tools/sfdxcli
) else (
    echo ✅ Salesforce CLI detected
)

REM Install backend dependencies
echo 📦 Installing backend dependencies...
npm install
if %errorlevel% neq 0 (
    echo ❌ Failed to install backend dependencies
    pause
    exit /b 1
)

REM Install frontend dependencies
echo 📦 Installing frontend dependencies...
cd client
npm install
if %errorlevel% neq 0 (
    echo ❌ Failed to install frontend dependencies
    pause
    exit /b 1
)
cd ..

REM Create necessary directories
echo 📁 Creating necessary directories...
if not exist logs mkdir logs
if not exist temp mkdir temp
if not exist jobs mkdir jobs
if not exist uploads mkdir uploads

REM Org configuration is optional: orgs are managed in the UI (Organization Management).
if not exist environments.properties (
    echo ℹ️  No environments.properties - add orgs in Organization Management, or copy
    echo    environments.properties.example to environments.properties and edit it.
)

REM Start the application
echo 🚀 Starting Vlocity DataPack Manager...

REM Check if we should run in development or production mode
if "%1"=="dev" (
    echo 🔧 Starting in development mode...
    npm run dev-full
) else (
    echo 🏭 Building and starting in production mode...
    npm run build
    npm start
)

pause
