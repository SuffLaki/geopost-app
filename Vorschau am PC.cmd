@echo off
title GeoPost - Vorschau am PC
cd /d "%~dp0"
echo.
echo   GeoPost wird zur Ansicht geoeffnet ...
echo.
python "tools\serve.py" 8777
pause >nul
