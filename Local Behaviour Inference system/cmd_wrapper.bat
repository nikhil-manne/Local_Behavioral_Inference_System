@echo off
echo %* >> "%~dp0cmd_history.log"
start /b node "%~dp0log_cmd.js" %*
%*
