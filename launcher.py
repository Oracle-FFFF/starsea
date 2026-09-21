# -*- coding: utf-8 -*-
"""《星海余烬》启动器：寻找可用的 Python，启动 server.py 并打开浏览器。"""
import os
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PORT = int(os.environ.get("STARSEA_PORT") or 8090)
URL = "http://127.0.0.1:%d" % PORT


def find_python():
    candidates = []
    for name in ("python", "python3", "py"):
        candidates.append(name)
    venv_python = BASE_DIR / "venv" / "Scripts" / "python.exe"
    if venv_python.exists():
        candidates.insert(0, str(venv_python))
    for name in candidates:
        try:
            out = subprocess.run(
                [name, "--version"], capture_output=True, timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
            )
            if out.returncode == 0:
                return name
        except Exception:
            continue
    return None


def main():
    print("《星海余烬 · EMBERS OF THE STAR SEA》v0.05 启动器")
    python = find_python()
    if not python:
        print("[错误] 未找到可用的 Python，请安装 Python 3.7+ 后重试。")
        input("按回车退出…")
        sys.exit(1)
    print("[1/3] 使用解释器: %s" % python)
    print("[2/3] 启动服务器: %s" % URL)
    try:
        proc = subprocess.Popen(
            [python, str(BASE_DIR / "server.py"), "--port", str(PORT)],
            cwd=str(BASE_DIR),
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
    except Exception as error:
        print("[错误] 启动失败：%s" % error)
        input("按回车退出…")
        sys.exit(1)
    print("[3/3] 等待服务器就绪…")
    for _ in range(60):
        time.sleep(0.5)
        if proc.poll() is not None:
            print("[错误] 服务器进程已退出（端口 %d 可能被占用）。" % PORT)
            input("按回车退出…")
            sys.exit(1)
        try:
            import urllib.request

            with urllib.request.urlopen(URL + "/api/health", timeout=1) as resp:
                resp.read(32)
            break
        except Exception:
            continue
    try:
        webbrowser.open(URL)
    except Exception:
        pass
    print("已在浏览器打开游戏。关闭本窗口即停止服务器。")
    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        print("\n再见，星海旅人。")


if __name__ == "__main__":
    main()
