@echo off
rem Runs the app on a separate demo database (data\demo.db) filled with sample data.
rem Your real data in data\portfolio.db is never touched.
set PT_DEMO=1
call "%~dp0start.bat" %*
