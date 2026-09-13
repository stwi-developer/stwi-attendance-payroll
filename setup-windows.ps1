# Run from the project root after Node.js and MySQL are installed.
$ErrorActionPreference = 'Stop'
Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
Push-Location backend
npm install
Copy-Item .env.example .env -Force
Write-Host "Edit backend/.env with your MySQL username/password and a strong JWT_SECRET." -ForegroundColor Yellow
Pop-Location
Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
Push-Location frontend
npm install
Pop-Location
Write-Host "Setup packages complete. Now create the MySQL database and run Prisma migration/seed as shown in README." -ForegroundColor Green
