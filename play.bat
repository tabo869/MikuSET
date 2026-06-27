@echo off
setlocal enabledelayedexpansion
title MikuSET - マジカル・ゲスト ランチャー
chcp 65001 >nul

echo ==========================================================
echo   MikuSET (マジカル・ゲスト) Windows 自動起動スクリプト
echo ==========================================================
echo.

rem Node.jsのインストール確認
where node >nul 2>nul
if !errorlevel! neq 0 (
    echo [エラー] Node.js がシステムに見つかりません。
    echo.
    echo このゲームで遊ぶには Node.js のインストールが必要です。
    echo 公式サイト ( https://nodejs.org/ ) から LTS版 (推奨版) を
    echo ダウンロードしてインストールし、このPCを再起動した後に再度実行してください。
    echo.
    pause
    exit /b 1
)

echo [1/3] 依存関係 (ライブラリ) の状態を確認・インストール中...
echo (初回起動時は1〜2分程度かかる場合があります。このままお待ちください)
echo.
call npm install
if !errorlevel! neq 0 (
    echo.
    echo [警告] npm install 中にエラーが発生しました。
    echo インターネット接続を確認してください。起動を試みます...
    echo.
)

echo.
echo [2/3] ローカルサーバーを起動しています...
echo.

rem 開発サーバー起動前に、ブラウザでローカルアドレスを開く
echo [3/3] ブラウザでゲームを起動します...
start http://localhost:5173/

rem Vite 開発サーバーを起動
call npm run dev

pause
