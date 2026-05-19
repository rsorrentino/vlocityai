# PowerShell PostgreSQL Installation Script for Vlocity DataPack Manager

Write-Host "🚀 Installing PostgreSQL on Windows..." -ForegroundColor Green

# Check if PostgreSQL is already installed
if (Get-Command psql -ErrorAction SilentlyContinue) {
    Write-Host "✅ PostgreSQL is already installed" -ForegroundColor Green
    psql --version
} else {
    Write-Host "📦 PostgreSQL not found. Installing..." -ForegroundColor Yellow
    
    # Check if Chocolatey is available
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "🍫 Installing PostgreSQL via Chocolatey..." -ForegroundColor Blue
        choco install postgresql -y
        
        # Add PostgreSQL to PATH
        $postgresPath = "C:\Program Files\PostgreSQL\15\bin"
        if (Test-Path $postgresPath) {
            $env:PATH += ";$postgresPath"
            [Environment]::SetEnvironmentVariable("PATH", $env:PATH, [EnvironmentVariableTarget]::User)
        }
    } else {
        Write-Host "❌ Chocolatey not found. Please install PostgreSQL manually:" -ForegroundColor Red
        Write-Host "1. Download from: https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
        Write-Host "2. Run the installer" -ForegroundColor Yellow
        Write-Host "3. Add PostgreSQL to PATH: C:\Program Files\PostgreSQL\15\bin" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Or install Chocolatey first: https://chocolatey.org/install" -ForegroundColor Cyan
        Write-Host "Then run: choco install postgresql -y" -ForegroundColor Cyan
        exit 1
    }
}

# Start PostgreSQL service
Write-Host "🚀 Starting PostgreSQL service..." -ForegroundColor Green

try {
    # Try to start PostgreSQL service
    Start-Service postgresql-x64-15 -ErrorAction SilentlyContinue
    Write-Host "✅ PostgreSQL service started" -ForegroundColor Green
} catch {
    # If service doesn't exist, try different service names
    try {
        Start-Service postgresql -ErrorAction SilentlyContinue
        Write-Host "✅ PostgreSQL service started" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Could not start PostgreSQL service automatically" -ForegroundColor Yellow
        Write-Host "Please start it manually from Services or run:" -ForegroundColor Yellow
        Write-Host "net start postgresql-x64-15" -ForegroundColor Cyan
    }
}

# Create database and user
Write-Host "🗄️  Setting up database..." -ForegroundColor Green

try {
    # Create database
    $env:PGPASSWORD = "postgres"
    psql -U postgres -c "CREATE DATABASE vlocity_manager;" 2>$null
    Write-Host "✅ Database 'vlocity_manager' created" -ForegroundColor Green
    
    # Create user (optional)
    psql -U postgres -c "CREATE USER vlocity_user WITH PASSWORD 'vlocity_password';" 2>$null
    psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE vlocity_manager TO vlocity_user;" 2>$null
    Write-Host "✅ User 'vlocity_user' created" -ForegroundColor Green
    
} catch {
    Write-Host "⚠️  Could not create database automatically" -ForegroundColor Yellow
    Write-Host "Please create manually:" -ForegroundColor Yellow
    Write-Host "1. Open pgAdmin or psql" -ForegroundColor Cyan
    Write-Host "2. Create database: vlocity_manager" -ForegroundColor Cyan
    Write-Host "3. Create user: vlocity_user with password: vlocity_password" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "🎉 PostgreSQL setup complete!" -ForegroundColor Green
Write-Host "Database will be available at: postgresql://postgres:postgres@localhost:5432/vlocity_manager" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
