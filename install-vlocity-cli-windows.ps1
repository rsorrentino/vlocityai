# PowerShell Vlocity CLI Installation Script for Windows

Write-Host "🚀 Installing Vlocity CLI on Windows..." -ForegroundColor Green

# Check if Vlocity CLI is already installed
if (Get-Command vlocity -ErrorAction SilentlyContinue) {
    Write-Host "✅ Vlocity CLI is already installed" -ForegroundColor Green
    vlocity --version
    exit 0
}

Write-Host "📦 Vlocity CLI not found. Installing..." -ForegroundColor Yellow

# Check if Node.js is available
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js not found. Please install Node.js first:" -ForegroundColor Red
    Write-Host "1. Download from: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "2. Run the installer" -ForegroundColor Yellow
    Write-Host "3. Restart PowerShell and try again" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Node.js version $(node --version) detected" -ForegroundColor Green

# Check if npm is available
if (!(Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "❌ npm not found. Please install npm first" -ForegroundColor Red
    exit 1
}

Write-Host "✅ npm version $(npm --version) detected" -ForegroundColor Green

# Install Vlocity CLI globally
Write-Host "📦 Installing Vlocity CLI globally..." -ForegroundColor Blue
try {
    npm install -g vlocity
    
    # Verify installation
    if (Get-Command vlocity -ErrorAction SilentlyContinue) {
        Write-Host "✅ Vlocity CLI installed successfully!" -ForegroundColor Green
        Write-Host "Version: $(vlocity --version)" -ForegroundColor Cyan
        
        # Test basic functionality
        Write-Host "🧪 Testing Vlocity CLI..." -ForegroundColor Blue
        vlocity --help | Select-Object -First 5
        
        Write-Host ""
        Write-Host "🎉 Vlocity CLI installation complete!" -ForegroundColor Green
        Write-Host "You can now use Vlocity CLI commands in your terminal." -ForegroundColor Cyan
    } else {
        Write-Host "❌ Installation completed but Vlocity CLI not found in PATH" -ForegroundColor Red
        Write-Host "Please restart your terminal or add npm global bin to PATH" -ForegroundColor Yellow
        Write-Host "Global npm path: $(npm config get prefix)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Installation failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Manual installation options:" -ForegroundColor Yellow
    Write-Host "1. Run: npm install -g vlocity" -ForegroundColor Cyan
    Write-Host "2. Visit: https://developer.salesforce.com/docs/atlas.en-us.vlocity_cli.meta/vlocity_cli/" -ForegroundColor Cyan
    exit 1
}

Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
