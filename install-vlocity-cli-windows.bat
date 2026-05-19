@echo off
REM Windows Vlocity CLI Installation Script

echo 🚀 Installing Vlocity CLI on Windows...

REM Check if Vlocity CLI is already installed
where vlocity >nul 2>nul
if %errorlevel% == 0 (
    echo ✅ Vlocity CLI is already installed
    vlocity --version
    pause
    exit /b 0
)

echo 📦 Vlocity CLI not found. Installing...

REM Check if Node.js is available
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js not found. Please install Node.js first:
    echo 1. Download from: https://nodejs.org/
    echo 2. Run the installer
    echo 3. Restart Command Prompt and try again
    pause
    exit /b 1
)

echo ✅ Node.js detected

REM Check if npm is available
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ npm not found. Please install npm first
    pause
    exit /b 1
)

echo ✅ npm detected

REM Install Vlocity CLI globally
echo 📦 Installing Vlocity CLI globally...
npm install -g vlocity

REM Verify installation
where vlocity >nul 2>nul
if %errorlevel% == 0 (
    echo ✅ Vlocity CLI installed successfully!
    vlocity --version
    
    echo 🧪 Testing Vlocity CLI...
    vlocity --help
    
    echo.
    echo 🎉 Vlocity CLI installation complete!
    echo You can now use Vlocity CLI commands in your terminal.
) else (
    echo ❌ Installation completed but Vlocity CLI not found in PATH
    echo Please restart your terminal or add npm global bin to PATH
    echo Global npm path:
    npm config get prefix
)

echo.
pause
