$ErrorActionPreference = 'Stop'
Start-Process powershell -ArgumentList '-NoExit','-Command','Set-Location backend; npm run start:dev'
Start-Process powershell -ArgumentList '-NoExit','-Command','Set-Location frontend; npm run dev'
