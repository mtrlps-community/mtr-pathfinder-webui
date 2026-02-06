import os
import sys
import urllib3
from difflib import SequenceMatcher
from enum import Enum
from math import gcd, sqrt
from operator import itemgetter
from statistics import median_low
from threading import Thread, BoundedSemaphore
from time import gmtime, strftime, time
from typing import Union
from queue import Queue
import base64
import hashlib
import json
import pickle
import re

from datetime import datetime, timedelta, timezone
from statistics import mode
import random

from opencc import OpenCC
import networkx as nx
import requests

from flask import Flask, render_template_string, request, jsonify, session

app = Flask(__name__)
app.secret_key = os.urandom(24)

import mtr_pathfinder
import mtr_pathfinder_v4
import mtr_timetable_github

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

os.chdir(os.path.dirname(os.path.abspath(__file__)))

CONFIG = {}
config_file = 'config.json'
if os.path.exists(config_file):
    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            CONFIG = json.load(f)
    except:
        pass

if 'secret_key' not in CONFIG:
    CONFIG['secret_key'] = os.urandom(32).hex()
if 'admin_username' not in CONFIG:
    CONFIG['admin_username'] = 'admin'
if 'admin_password' not in CONFIG:
    CONFIG['admin_password'] = 'admin'
if 'UMAMI_SCRIPT_URL' not in CONFIG:
    CONFIG['UMAMI_SCRIPT_URL'] = ''
if 'UMAMI_WEBSITE_ID' not in CONFIG:
    CONFIG['UMAMI_WEBSITE_ID'] = ''
if 'MAX_WILD_BLOCKS' not in CONFIG:
    CONFIG['MAX_WILD_BLOCKS'] = 1500

with open(config_file, 'w', encoding='utf-8') as f:
    json.dump(CONFIG, f, indent=4, ensure_ascii=False)

app.secret_key = CONFIG['secret_key'].encode()

ROUTE_INTERVAL_DATA = Queue()
semaphore = BoundedSemaphore(25)
original = {}
tmp_names = {}

opencc1 = OpenCC('s2t')
opencc2 = OpenCC('t2jp')
opencc3 = OpenCC('t2s')
opencc4 = OpenCC('jp2t')

LOGIN_HTML = '''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MTR路径查找器 - 管理登录</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', 'Microsoft YaHei', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            width: 100%;
            max-width: 400px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #4a90e2, #50e3c2);
            color: white;
            padding: 20px;
            text-align: center;
        }
        .header h1 {
            font-size: 1.5rem;
        }
        .content {
            padding: 30px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        .form-group input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e9ecef;
            border-radius: 6px;
            font-size: 1rem;
        }
        .form-group input:focus {
            outline: none;
            border-color: #4a90e2;
        }
        .btn {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 6px;
            background: linear-gradient(135deg, #4a90e2, #50e3c2);
            color: white;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.3s;
        }
        .btn:hover {
            opacity: 0.9;
        }
        .alert {
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            display: none;
        }
        .alert.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .footer {
            background: #f8f9fa;
            padding: 15px;
            text-align: center;
            font-size: 0.875rem;
            color: #6c757d;
        }
        .footer a {
            color: #4a90e2;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 管理登录</h1>
        </div>
        <div class="content">
            <div id="alert" class="alert error"></div>
            <form id="loginForm">
                <div class="form-group">
                    <label for="username">用户名</label>
                    <input type="text" id="username" name="username" required>
                </div>
                <div class="form-group">
                    <label for="password">密码</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <button type="submit" class="btn">登录</button>
            </form>
        </div>
        <div class="footer">
            <a href="/">返回首页</a>
        </div>
    </div>
    <script>
        document.getElementById('loginForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            try {
                const response = await fetch('/admin/login-ajax', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        username: username,
                        password: password
                    })
                });
                const data = await response.json();
                if (data.success) {
                    window.location.href = '/admin';
                } else {
                    const alert = document.getElementById('alert');
                    alert.textContent = data.message || '登录失败';
                    alert.style.display = 'block';
                }
            } catch (error) {
                console.error('登录失败:', error);
                const alert = document.getElementById('alert');
                alert.textContent = '登录失败，请重试';
                alert.style.display = 'block';
            }
        });
    </script>
</body>
</html>
'''

ADMIN_CSS = '''
<style>
    :root {
        --primary: #4a90e2;
        --secondary: #50e3c2;
        --bg-dark: #1a1a2e;
        --bg-card: #16213e;
        --text: #e0e0e0;
        --border: #2a3a5a;
    }
    body {
        font-family: 'Segoe UI', 'Microsoft YaHei', Arial, sans-serif;
        background: var(--bg-dark);
        color: var(--text);
        margin: 0;
        min-height: 100vh;
    }
    header {
        background: linear-gradient(135deg, #16213e, #0f3460);
        padding: 15px 30px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }
    header h1 {
        font-size: 1.5rem;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    nav a {
        color: var(--text);
        text-decoration: none;
        margin-left: 20px;
        padding: 8px 16px;
        border-radius: 4px;
        transition: background 0.3s;
    }
    nav a:hover, nav a.active {
        background: rgba(74, 144, 226, 0.2);
    }
    .container {
        padding: 30px;
        max-width: 1400px;
        margin: 0 auto;
    }
    .card {
        background: var(--bg-card);
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 20px;
        border: 1px solid var(--border);
    }
    .card h2 {
        margin-bottom: 20px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--border);
    }
    .form-group {
        margin-bottom: 15px;
    }
    .form-group label {
        display: block;
        margin-bottom: 8px;
        font-weight: 600;
    }
    .form-group input[type="text"],
    .form-group input[type="number"],
    .form-group input[type="password"],
    .form-group select,
    .form-group textarea {
        width: 100%;
        padding: 12px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-dark);
        color: var(--text);
        font-size: 1rem;
    }
    .form-group input:focus,
    .form-group select:focus,
    .form-group textarea:focus {
        outline: none;
        border-color: var(--primary);
    }
    .btn {
        padding: 12px 24px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1rem;
        font-weight: 600;
        transition: opacity 0.3s;
    }
    .btn:hover {
        opacity: 0.9;
    }
    .btn-primary {
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        color: white;
    }
    .btn-danger {
        background: #dc3545;
        color: white;
    }
    .btn-success {
        background: #28a745;
        color: white;
    }
    .alert {
        padding: 15px;
        border-radius: 4px;
        margin-bottom: 20px;
        display: none;
    }
    .alert.success {
        background: #28a745;
        color: white;
    }
    .alert.error {
        background: #dc3545;
        color: white;
    }
    .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 20px;
        margin-bottom: 30px;
    }
    .stat-card {
        background: var(--bg-card);
        padding: 20px;
        border-radius: 8px;
        text-align: center;
        border: 1px solid var(--border);
    }
    .stat-card .number {
        font-size: 2rem;
        font-weight: bold;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    .log-container {
        background: #0d1117;
        border-radius: 4px;
        padding: 15px;
        max-height: 300px;
        overflow-y: auto;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 0.875rem;
    }
    .log-entry {
        margin-bottom: 5px;
        padding: 5px;
        border-radius: 4px;
    }
    .log-entry.error {
        background: rgba(220, 53, 69, 0.2);
        color: #ff6b6b;
    }
    .log-entry.success {
        background: rgba(40, 167, 69, 0.2);
        color: #69db7c;
    }
    .log-entry.info {
        background: rgba(74, 144, 226, 0.2);
        color: #74c0fc;
    }
    .config-section {
        margin-bottom: 30px;
    }
    .config-section h3 {
        margin-bottom: 15px;
        color: var(--secondary);
    }
    .checkbox-group {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
    }
    .checkbox-item {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    @media (max-width: 768px) {
        header {
            flex-direction: column;
            gap: 10px;
        }
        nav {
            margin-top: 10px;
        }
        nav a {
            margin: 0 5px;
        }
    }
</style>
'''

ADMIN_HTML = '''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MTR路径查找器 - 控制台</title>
    ''' + ADMIN_CSS + '''
    {% if config['UMAMI_SCRIPT_URL'] and config['UMAMI_WEBSITE_ID'] %}
    <script defer src="{{ config['UMAMI_SCRIPT_URL'] }}" data-website-id="{{ config['UMAMI_WEBSITE_ID'] }}"></script>
    {% endif %}
</head>
<body>
    <header>
        <h1>⚙️ MTR路径查找器控制台</h1>
        <nav>
            <a href="/">🏠 首页</a>
            <a href="/stations">🚉 车站</a>
            <a href="/routes">🛤️ 线路</a>
            <a href="/admin" class="active">⚙️ 控制台</a>
            <a href="/admin/logout">🚪 退出</a>
        </nav>
    </header>
    
    <div class="container">
        <div id="alert" class="alert"></div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="number" id="station-count">-</div>
                <div>车站数量</div>
            </div>
            <div class="stat-card">
                <div class="number" id="route-count">-</div>
                <div>线路数量</div>
            </div>
            <div class="stat-card">
                <div class="number" id="data-version">-</div>
                <div>数据版本</div>
            </div>
        </div>
        
        <div class="card">
            <h2>📊 数据统计</h2>
            <div id="stats-content">
                <p>正在加载数据...</p>
            </div>
        </div>
        
        <div class="card">
            <h2>🔧 基础设置</h2>
            <form id="configForm">
                <div class="config-section">
                    <h3>🗺️ MTR设置</h3>
                    <div class="form-group">
                        <label for="mtr_version">MTR版本</label>
                        <select id="mtr_version" name="mtr_version">
                            <option value="3" {{ 'selected' if config.get('mtr_version', 3) == 3 else '' }}>MTR 3.x</option>
                            <option value="4" {{ 'selected' if config.get('mtr_version', 3) == 4 else '' }}>MTR 4.x</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="link">线路图链接</label>
                        <input type="text" id="link" name="link" value="{{ config.get('link', '') }}" placeholder="https://example.com">
                    </div>
                    <div class="form-group">
                        <label for="max_wild_blocks">最大越野距离</label>
                        <input type="number" id="max_wild_blocks" name="max_wild_blocks" value="{CONFIG.get('MAX_WILD_BLOCKS', 1500)}" min="100" max="5000">
                    </div>
                </div>
                
                <div class="config-section">
                    <h3>🔐 登录设置</h3>
                    <div class="form-group">
                        <label for="admin_username">用户名</label>
                        <input type="text" id="admin_username" name="admin_username" value="{CONFIG.get('admin_username', 'admin')}">
                    </div>
                    <div class="form-group">
                        <label for="admin_password">新密码 (留空则不修改)</label>
                        <input type="password" id="admin_password" name="admin_password" placeholder="输入新密码">
                    </div>
                </div>
                
                <div class="config-section">
                    <h3>📈 分析设置</h3>
                    <div class="checkbox-group">
                        <div class="checkbox-item">
                            <input type="checkbox" id="calculate_high_speed" name="calculate_high_speed" {{ 'checked' if config.get('calculate_high_speed', True) }}>
                            <label for="calculate_high_speed">允许高铁</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="calculate_boat" name="calculate_boat" {{ 'checked' if config.get('calculate_boat', True) }}>
                            <label for="calculate_boat">允许船只</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="calculate_wild" name="calculate_wild" {{ 'checked' if config.get('calculate_wild', False) }}>
                            <label for="calculate_wild">允许越野</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="only_lrt" name="only_lrt" {{ 'checked' if config.get('only_lrt', False) }}>
                            <label for="only_lrt">仅轻轨</label>
                        </div>
                    </div>
                </div>
                
                <div class="config-section">
                    <h3>📝 站点过滤</h3>
                    <div class="form-group">
                        <label for="ignored_lines">禁用的线路 (每行一条)</label>
                        <textarea id="ignored_lines" name="ignored_lines" rows="5" placeholder="每行一条线路名称">{{ '\\n'.join(config.get('ignored_lines', [])) }}</textarea>
                    </div>
                    <div class="form-group">
                        <label for="avoid_stations">避开的站点 (每行一条)</label>
                        <textarea id="avoid_stations" name="avoid_stations" rows="5" placeholder="每行一个站点名称">{{ '\\n'.join(config.get('avoid_stations', [])) }}</textarea>
                    </div>
                </div>
                
                <button type="submit" class="btn btn-primary">💾 保存设置</button>
            </form>
        </div>
        
        <div class="card">
            <h2>📥 数据更新</h2>
            <div id="update-content">
                <p>点击下方按钮更新数据 (将会覆盖现有数据文件)</p>
                <button id="update-data-btn" class="btn btn-success">📥 更新车站数据</button>
                <button id="update-interval-btn" class="btn btn-success">⏱️ 更新间隔数据</button>
                <button id="update-departure-btn" class="btn btn-success">🚆 更新实时数据</button>
            </div>
        </div>
        
        <div class="card">
            <h2>📋 运行日志</h2>
            <div id="log-container" class="log-container">
                <div class="log-entry info">系统已启动</div>
            </div>
        </div>
    </div>
    
    {% raw %}<script>
        function addLog(message, type = 'info') {
            const container = document.getElementById('log-container');
            const entry = document.createElement('div');
            entry.className = 'log-entry ' + type;
            entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        }}
        
        document.getElementById('configForm').addEventListener('submit', async function(e) {{
            e.preventDefault();
            addLog('正在保存配置...', 'info');
            
            const formData = new FormData(this);
            const ignoredLines = formData.get('ignored_lines').split('\\n').filter(line => line.trim());
            const avoidStations = formData.get('avoid_stations').split('\\n').filter(line => line.trim());
            
            const data = {{
                mtr_version: parseInt(formData.get('mtr_version')),
                link: formData.get('link'),
                max_wild_blocks: parseInt(formData.get('max_wild_blocks')),
                admin_username: formData.get('admin_username'),
                admin_password: formData.get('admin_password') || undefined,
                calculate_high_speed: formData.get('calculate_high_speed') === 'on',
                calculate_boat: formData.get('calculate_boat') === 'on',
                calculate_wild: formData.get('calculate_wild') === 'on',
                only_lrt: formData.get('only_lrt') === 'on',
                ignored_lines: ignoredLines,
                avoid_stations: avoidStations
            }};
            
            try {{
                const response = await fetch('/admin/update-config-ajax', {{
                    method: 'POST',
                    headers: {{
                        'Content-Type': 'application/json'
                    }},
                    body: JSON.stringify(data)
                }});
                const result = await response.json();
                const alert = document.getElementById('alert');
                if (result.success) {{
                    alert.className = 'alert success';
                    alert.textContent = '配置已保存';
                    addLog('配置已保存', 'success');
                }} else {{
                    alert.className = 'alert error';
                    alert.textContent = result.message || '保存失败';
                    addLog('保存失败: ' + (result.message || '未知错误'), 'error');
                }}
                alert.style.display = 'block';
                setTimeout(() => alert.style.display = 'none', 3000);
            }} catch (error) {{
                console.error('保存失败:', error);
                addLog('保存失败: ' + error.message, 'error');
            }}
        }});
        
        document.getElementById('update-data-btn').addEventListener('click', async function() {{
            addLog('正在更新车站数据...', 'info');
            this.disabled = true;
            try {{
                const response = await fetch('/admin/update-data-ajax', {{
                    method: 'POST',
                    headers: {{
                        'Content-Type': 'application/json'
                    }},
                    body: JSON.stringify({{ type: 'station' }})
                }});
                const result = await response.json();
                if (result.success) {{
                    addLog('车站数据更新成功!', 'success');
                    loadStats();
                }} else {{
                    addLog('车站数据更新失败: ' + (result.message || '未知错误'), 'error');
                }}
            }} catch (error) {{
                addLog('车站数据更新失败: ' + error.message, 'error');
            }}
            this.disabled = false;
        }});
        
        document.getElementById('update-interval-btn').addEventListener('click', async function() {{
            addLog('正在更新间隔数据...', 'info');
            this.disabled = true;
            try {{
                const response = await fetch('/admin/update-data-ajax', {{
                    method: 'POST',
                    headers: {{
                        'Content-Type': 'application/json'
                    }},
                    body: JSON.stringify({{ type: 'interval' }})
                }});
                const result = await response.json();
                if (result.success) {{
                    addLog('间隔数据更新成功!', 'success');
                }} else {{
                    addLog('间隔数据更新失败: ' + (result.message || '未知错误'), 'error');
                }}
            }} catch (error) {{
                addLog('间隔数据更新失败: ' + error.message, 'error');
            }}
            this.disabled = false;
        }});
        
        document.getElementById('update-departure-btn').addEventListener('click', async function() {{
            addLog('正在更新实时数据...', 'info');
            this.disabled = true;
            try {{
                const response = await fetch('/admin/update-data-ajax', {{
                    method: 'POST',
                    headers: {{
                        'Content-Type': 'application/json'
                    }},
                    body: JSON.stringify({{ type: 'departure' }})
                }});
                const result = await response.json();
                if (result.success) {{
                    addLog('实时数据更新成功!', 'success');
                }} else {{
                    addLog('实时数据更新失败: ' + (result.message || '未知错误'), 'error');
                }}
            }} catch (error) {{
                addLog('实时数据更新失败: ' + error.message, 'error');
            }}
            this.disabled = false;
        }});
        
        async function loadStats() {{
            try {{
                const response = await fetch('/api/stats');
                const stats = await response.json();
                document.getElementById('station-count').textContent = stats.stations;
                document.getElementById('route-count').textContent = stats.routes;
                document.getElementById('data-version').textContent = stats.version || 'N/A';
            }} catch (error) {{
                console.error('加载统计信息失败:', error);
            }}
        }}
        
        loadStats();
    </script>{% endraw %}
</body>
</html>
'''

STATIONS_CSS = '''
<style>
    :root {
        --primary: #4a90e2;
        --secondary: #50e3c2;
        --bg-dark: #1a1a2e;
        --bg-card: #16213e;
        --text: #e0e0e0;
        --border: #2a3a5a;
    }
    body {
        font-family: 'Segoe UI', 'Microsoft YaHei', Arial, sans-serif;
        background: var(--bg-dark);
        color: var(--text);
        margin: 0;
        min-height: 100vh;
    }
    header {
        background: linear-gradient(135deg, #16213e, #0f3460);
        padding: 15px 30px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }
    header h1 {
        font-size: 1.5rem;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    nav a {
        color: var(--text);
        text-decoration: none;
        margin-left: 20px;
        padding: 8px 16px;
        border-radius: 4px;
        transition: background 0.3s;
    }
    nav a:hover, nav a.active {
        background: rgba(74, 144, 226, 0.2);
    }
    .container {
        padding: 30px;
        max-width: 1400px;
        margin: 0 auto;
    }
    .stats {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        flex-wrap: wrap;
        gap: 10px;
    }
    .stats .number {
        font-size: 1.5rem;
        font-weight: bold;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    .search-box {
        margin-bottom: 20px;
    }
    .search-box input {
        width: 100%;
        max-width: 400px;
        padding: 12px 20px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg-card);
        color: var(--text);
        font-size: 1rem;
    }
    .search-box input:focus {
        outline: none;
        border-color: var(--primary);
    }
    .list-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
        gap: 20px;
    }
    .station-card {
        background: var(--bg-card);
        border-radius: 8px;
        padding: 20px;
        border: 1px solid var(--border);
        transition: all 0.3s;
        cursor: pointer;
    }
    .station-card:hover {
        border-color: var(--primary);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .station-name {
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 8px;
    }
    .station-id {
        font-size: 0.875rem;
        color: #888;
        margin-bottom: 10px;
    }
    .route-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .route-tag {
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
    }
    .route-tag.train { background: #4a90e2; }
    .route-tag.light_rail { background: #50e3c2; }
    .route-tag.high_speed { background: #dc3545; }
    .route-tag.boat { background: #17a2b8; }
    .no-data {
        text-align: center;
        padding: 50px;
        color: rgba(255,255,255,0.5);
    }
    @media (max-width: 768px) {
        header {
            flex-direction: column;
            gap: 10px;
        }
        .list-container {
            grid-template-columns: 1fr;
        }
    }
</style>
'''

STATIONS_HTML = '''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MTR路径查找器 - 车站列表</title>
    ''' + STATIONS_CSS + '''
    {% if config['UMAMI_SCRIPT_URL'] and config['UMAMI_WEBSITE_ID'] %}
    <script defer src="{{ config['UMAMI_SCRIPT_URL'] }}" data-website-id="{{ config['UMAMI_WEBSITE_ID'] }}"></script>
    {% endif %}
</head>
<body>
    <header>
        <h1>🚉 车站列表</h1>
        <nav>
            <a href="/">🏠 首页</a>
            <a href="/stations" class="active">🚉 车站</a>
            <a href="/routes">🛤️ 线路</a>
            <a href="/admin">⚙️ 控制台</a>
        </nav>
    </header>
    
    <div class="container">
        <div class="stats">
            <span>车站总数: <span class="number">{{ count }}</span></span>
        </div>
        
        <div class="search-box">
            <input type="text" id="search" placeholder="搜索车站..." oninput="filterItems()">
        </div>
        
        <div class="list-container" id="station-list">
            {% for station in stations %}
            <div class="station-card" data-name="{{ station.name|lower }}" onclick="showStationDetails('{{ station.id }}')">
                <div class="station-name">{{ station.name }}</div>
                <div class="station-id">ID: {{ station.short_id }}</div>
                <div class="route-list">
                    {% for route in station.routes[:5] %}
                    <span class="route-tag {{ route.type }}">{{ route.name }}</span>
                    {% endfor %}
                    {% if station.routes|length > 5 %}
                    <span class="route-tag">+{{ station.routes|length - 5 }}条</span>
                    {% endif %}
                </div>
            </div>
            {% else %}
            <div class="no-data">暂无车站数据，请先更新数据</div>
            {% endfor %}
        </div>
    </div>
    
    {% raw %}<script>
    function filterItems() {
        const query = document.getElementById('search').value.toLowerCase();
        
        document.querySelectorAll('.station-card').forEach(card => {
            const name = card.dataset.name || '';
            card.style.display = name.includes(query) ? '' : 'none';
        });
    }
    
    function showStationDetails(stationId) {
        window.location.href = '/timetable?station=' + stationId;
    }
    </script>{% endraw %}
</body>
</html>
'''

ROUTES_CSS = '''
<style>
    :root {
        --primary: #4a90e2;
        --secondary: #50e3c2;
        --bg-dark: #1a1a2e;
        --bg-card: #16213e;
        --text: #e0e0e0;
        --border: #2a3a5a;
    }
    body {
        font-family: 'Segoe UI', 'Microsoft YaHei', Arial, sans-serif;
        background: var(--bg-dark);
        color: var(--text);
        margin: 0;
        min-height: 100vh;
    }
    header {
        background: linear-gradient(135deg, #16213e, #0f3460);
        padding: 15px 30px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }
    header h1 {
        font-size: 1.5rem;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    nav a {
        color: var(--text);
        text-decoration: none;
        margin-left: 20px;
        padding: 8px 16px;
        border-radius: 4px;
        transition: background 0.3s;
    }
    nav a:hover, nav a.active {
        background: rgba(74, 144, 226, 0.2);
    }
    .container {
        padding: 30px;
        max-width: 1400px;
        margin: 0 auto;
    }
    .stats {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        flex-wrap: wrap;
        gap: 10px;
    }
    .stats .number {
        font-size: 1.5rem;
        font-weight: bold;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    .search-box {
        margin-bottom: 20px;
    }
    .search-box input {
        width: 100%;
        max-width: 400px;
        padding: 12px 20px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg-card);
        color: var(--text);
        font-size: 1rem;
    }
    .search-box input:focus {
        outline: none;
        border-color: var(--primary);
    }
    .route-group {
        background: var(--bg-card);
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 15px;
        border: 1px solid var(--border);
        transition: all 0.3s;
    }
    .route-group.expanded .direction-stations {
        display: block;
    }
    .route-header {
        display: flex;
        align-items: center;
        gap: 15px;
    }
    .route-color {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        flex-shrink: 0;
    }
    .route-info {
        flex: 1;
    }
    .route-name {
        font-size: 1.1rem;
        font-weight: 600;
    }
    .route-selector {
        margin-top: 8px;
    }
    .route-select {
        width: 100%;
        max-width: 300px;
        padding: 8px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-dark);
        color: var(--text);
    }
    .expand-btn {
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 4px;
        background: rgba(74, 144, 226, 0.2);
        color: var(--text);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .direction-stations {
        display: none;
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid var(--border);
    }
    .station-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .station-tag {
        padding: 4px 12px;
        border-radius: 20px;
        background: rgba(74, 144, 226, 0.2);
        font-size: 0.875rem;
    }
    .station-tag:last-child::before {
        content: '';
        display: block;
        width: 8px;
        height: 8px;
        background: rgba(0, 255, 136, 0.5);
        border-radius: 50%;
        margin-right: 8px;
    }
    .station-tag.more {
        background: rgba(0, 217, 255, 0.15);
        color: #00d9ff;
        justify-content: center;
    }
    .station-tag.more::before {
        display: none;
    }
    .no-data {
        text-align: center;
        padding: 50px;
        color: rgba(255, 255, 255, 0.5);
    }
    @media (max-width: 768px) {
        header {
            flex-direction: column;
            gap: 10px;
        }
        .route-header {
            flex-wrap: wrap;
        }
        .route-selector {
            width: 100%;
            margin-top: 10px;
        }
        .route-select {
            max-width: none;
        }
    }
</style>
'''

ROUTES_HTML = '''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MTR路径查找器 - 线路列表</title>
    ''' + ROUTES_CSS + '''
    {% if config['UMAMI_SCRIPT_URL'] and config['UMAMI_WEBSITE_ID'] %}
    <script defer src="{{ config['UMAMI_SCRIPT_URL'] }}" data-website-id="{{ config['UMAMI_WEBSITE_ID'] }}"></script>
    {% endif %}
</head>
<body>
    <header>
        <h1>🛤️ 线路列表</h1>
        <nav>
            <a href="/">🏠 首页</a>
            <a href="/stations">🚉 车站</a>
            <a href="/routes" class="active">🛤️ 线路</a>
            <a href="/admin">⚙️ 控制台</a>
        </nav>
    </header>
    
    <div class="container">
        <div class="stats">
            <span>线路总数: <span class="number">{{ count }}</span></span>
        </div>
        
        <div class="search-box">
            <input type="text" id="search" placeholder="搜索线路..." oninput="filterItems()">
        </div>
        
        <div class="list-container" id="route-list">
            {% for group in route_groups %}
            <div class="route-group" data-name="{{ group.name|lower }}" onclick="toggleGroup(this)">
                <div class="route-header">
                    {% if group.color %}
                    <div class="route-color" style="background-color: #{{ '%06x'|format(group.color) }}">
                        {% if group.type == 'train_high_speed' %}🚄
                        {% elif group.type == 'train_light_rail' %}🚃
                        {% else %}🚇{% endif %}
                    </div>
                    {% else %}
                    <div class="route-color" style="background: rgba(255,255,255,0.1)">🚇</div>
                    {% endif %}
                    <div class="route-info">
                        <div class="route-name">{{ group.name }}</div>
                        <div class="route-selector">
                            <select class="route-select" onclick="event.stopPropagation()" onchange="updateStations(this, '{{ loop.index }}')">
                                {% for direction in group.directions %}
                                <option value="{{ loop.index0 }}" 
                                        data-stations="{{ direction.stations|join(',') }}"
                                        data-color="{{ direction.color }}">
                                    {{ direction.direction }}
                                </option>
                                {% endfor %}
                            </select>
                        </div>
                    </div>
                    <button class="expand-btn" onclick="event.stopPropagation(); toggleGroup(this.closest('.route-group'))">
                        <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
                    </button>
                </div>
                <div class="direction-stations">
                    <div class="station-list" id="stations-{{ loop.index }}">
                        {% set first_dir = group.directions[0] %}
                        {% for station in first_dir.stations %}
                        <span class="station-tag">{{ station }}</span>
                        {% endfor %}
                    </div>
                </div>
            </div>
            {% else %}
            <div class="no-data">暂无线路数据，请先更新数据</div>
            {% endfor %}
        </div>
    </div>
    
    {% raw %}<script>
    function filterItems() {
        const query = document.getElementById('search').value.toLowerCase();
        
        document.querySelectorAll('.route-group').forEach(card => {
            const name = card.dataset.name || '';
            card.style.display = name.includes(query) ? '' : 'none';
        });
    }
    
    function toggleGroup(element) {
        element.classList.toggle('expanded');
    }
    
    function updateStations(select, index) {
        const option = select.options[select.selectedIndex];
        const stations = option.dataset.stations.split(',');
        const stationList = document.getElementById('stations-' + index);
        
        let html = '';
        for (let i = 0; i < Math.min(stations.length, 15); i++) {
            html += '<span class="station-tag">' + stations[i] + '</span>';
        }
        if (stations.length > 15) {
            html += '<span class="station-tag more">+' + (stations.length - 15) + '站</span>';
        }
        
        stationList.innerHTML = html;
    }
    </script>{% endraw %}
</body>
</html>
'''

INDEX_HTML = '''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MTR路径查找器</title>
    {% if config['UMAMI_SCRIPT_URL'] and config['UMAMI_WEBSITE_ID'] %}
    <script defer src="{{ config['UMAMI_SCRIPT_URL'] }}" data-website-id="{{ config['UMAMI_WEBSITE_ID'] }}"></script>
    {% endif %}
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', 'Microsoft YaHei', Arial, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: #e0e0e0;
            min-height: 100vh;
        }
        header {
            background: linear-gradient(135deg, #16213e, #0f3460);
            padding: 15px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        header h1 {
            font-size: 1.5rem;
            background: linear-gradient(135deg, #4a90e2, #50e3c2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        nav a {
            color: #e0e0e0;
            text-decoration: none;
            margin-left: 20px;
            padding: 8px 16px;
            border-radius: 4px;
            transition: all 0.3s;
        }
        nav a:hover, nav a.active {
            background: rgba(74, 144, 226, 0.2);
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 30px;
        }
        .search-section {
            text-align: center;
            margin-bottom: 40px;
        }
        .search-section h2 {
            font-size: 2rem;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #4a90e2, #50e3c2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .search-section p {
            color: #888;
            margin-bottom: 30px;
        }
        .search-box {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 15px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }
        .input-group {
            display: flex;
            align-items: center;
            background: rgba(22, 33, 62, 0.8);
            border-radius: 8px;
            padding: 15px 20px;
            border: 1px solid #2a3a5a;
            min-width: 280px;
        }
        .input-group .icon {
            font-size: 1.5rem;
            margin-right: 10px;
        }
        .input-group input {
            flex: 1;
            background: transparent;
            border: none;
            color: #e0e0e0;
            font-size: 1.1rem;
            outline: none;
        }
        .input-group input::placeholder {
            color: #666;
        }
        .swap-btn {
            width: 40px;
            height: 40px;
            border: none;
            border-radius: 50%;
            background: linear-gradient(135deg, #4a90e2, #50e3c2);
            color: white;
            cursor: pointer;
            font-size: 1.2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.3s;
        }
        .swap-btn:hover {
            transform: rotate(180deg);
        }
        .btn {
            padding: 15px 40px;
            border: none;
            border-radius: 8px;
            font-size: 1.1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn-primary {
            background: linear-gradient(135deg, #4a90e2, #50e3c2);
            color: white;
        }
        .btn-primary:hover {
            opacity: 0.9;
            transform: translateY(-2px);
        }
        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        .advanced-settings {
            background: rgba(22, 33, 62, 0.6);
            border-radius: 8px;
            padding: 20px;
            margin-top: 20px;
            border: 1px solid #2a3a5a;
        }
        .advanced-settings summary {
            cursor: pointer;
            padding: 10px;
            font-weight: 600;
            color: #4a90e2;
        }
        .advanced-settings .content {
            padding: 15px;
        }
        .settings-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
        }
        .setting-item {
            display: flex;
            flex-direction: column;
        }
        .setting-item label {
            margin-bottom: 8px;
            color: #888;
        }
        .setting-item input,
        .setting-item select {
            padding: 12px;
            border: 1px solid #2a3a5a;
            border-radius: 4px;
            background: rgba(26, 26, 46, 0.8);
            color: #e0e0e0;
            font-size: 1rem;
        }
        .setting-item input:focus,
        .setting-item select:focus {
            outline: none;
            border-color: #4a90e2;
        }
        .checkbox-group {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
        }
        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .checkbox-item input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }
        .quick-links {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 40px;
        }
        .quick-link {
            background: rgba(22, 33, 62, 0.6);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            text-decoration: none;
            color: #e0e0e0;
            border: 1px solid #2a3a5a;
            transition: all 0.3s;
        }
        .quick-link:hover {
            border-color: #4a90e2;
            transform: translateY(-2px);
        }
        .quick-link .icon {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        .quick-link h3 {
            font-size: 1.1rem;
            margin-bottom: 5px;
        }
        .quick-link p {
            font-size: 0.875rem;
            color: #888;
        }
        .result-container {
            background: rgba(22, 33, 62, 0.8);
            border-radius: 8px;
            padding: 30px;
            margin-top: 30px;
            border: 1px solid #2a3a5a;
            display: none;
        }
        .result-container.show {
            display: block;
        }
        .result-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid #2a3a5a;
        }
        .result-title {
            font-size: 1.5rem;
            font-weight: 600;
        }
        .result-stats {
            display: flex;
            gap: 30px;
        }
        .stat-item {
            text-align: center;
        }
        .stat-item .number {
            font-size: 1.5rem;
            font-weight: bold;
            background: linear-gradient(135deg, #4a90e2, #50e3c2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .stat-item .label {
            font-size: 0.875rem;
            color: #888;
        }
        .route-list {
            max-height: 500px;
            overflow-y: auto;
        }
        .route-item {
            background: rgba(26, 26, 46, 0.6);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
            border: 1px solid #2a3a5a;
        }
        .route-header {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
        }
        .route-color {
            width: 40px;
            height: 40px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 15px;
            font-size: 1.5rem;
        }
        .route-info {
            flex: 1;
        }
        .route-name {
            font-weight: 600;
        }
        .route-time {
            color: #888;
        }
        .route-stations {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .station-tag {
            padding: 4px 12px;
            background: rgba(74, 144, 226, 0.2);
            border-radius: 20px;
            font-size: 0.875rem;
        }
        .station-tag.transfer {
            background: rgba(80, 227, 194, 0.2);
        }
        .station-tag.end {
            background: rgba(0, 255, 136, 0.2);
        }
        .no-result {
            text-align: center;
            padding: 40px;
            color: #888;
        }
        .no-result .icon {
            font-size: 3rem;
            margin-bottom: 15px;
        }
        .footer {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 0.875rem;
            margin-top: 40px;
        }
        .footer a {
            color: #4a90e2;
            text-decoration: none;
        }
        @media (max-width: 768px) {
            header {
                flex-direction: column;
                gap: 15px;
            }
            .search-box {
                flex-direction: column;
            }
            .input-group {
                width: 100%;
            }
            .result-header {
                flex-direction: column;
                gap: 15px;
                align-items: flex-start;
            }
        }
    </style>
</head>
<body>
    <header>
        <h1>🚇 MTR路径查找器</h1>
        <nav>
            <a href="/" class="active">🏠 首页</a>
            <a href="/stations">🚉 车站</a>
            <a href="/routes">🛤️ 线路</a>
            <a href="/admin">⚙️ 控制台</a>
        </nav>
    </header>
    
    <div class="container">
        <div class="search-section">
            <h2>🔍 路线查询</h2>
            <p>输入起点和终点车站名称，查找最优路线</p>
            
            <div class="search-box">
                <div class="input-group">
                    <span class="icon">🚉</span>
                    <input type="text" id="startStation" placeholder="起点车站">
                </div>
                <button class="swap-btn" onclick="swapStations()" title="交换起终点">⇅</button>
                <div class="input-group">
                    <span class="icon">🏁</span>
                    <input type="text" id="endStation" placeholder="终点车站">
                </div>
                <button class="btn btn-primary" onclick="searchRoute()">查询</button>
            </div>
            
            <details class="advanced-settings">
                <summary>⚙️ 高级设置</summary>
                <div class="content">
                    <div class="settings-grid">
                        <div class="setting-item">
                            <label>MTR版本</label>
                            <select id="mtrVersion">
                                <option value="3">MTR 3.x</option>
                                <option value="4">MTR 4.x</option>
                            </select>
                        </div>
                        <div class="setting-item">
                            <label>查询模式</label>
                            <select id="searchMode">
                                <option value="waiting">考虑等车时间</option>
                                <option value="theory">理论最快(不考虑等车)</option>
                                <option value="realtime">实时查询</option>
                            </select>
                        </div>
                        <div class="setting-item">
                            <label>最大越野距离</label>
                            <input type="number" id="maxWild" value="1500" min="100" max="5000">
                        </div>
                        <div class="setting-item">
                            <label>出发时间 (仅实时查询)</label>
                            <input type="datetime-local" id="departureTime">
                        </div>
                    </div>
                    <div class="checkbox-group" style="margin-top: 15px;">
                        <div class="checkbox-item">
                            <input type="checkbox" id="allowHighSpeed" checked>
                            <label for="allowHighSpeed">允许高铁</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="allowBoat" checked>
                            <label for="allowBoat">允许船只</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="allowWild">
                            <label for="allowWild">允许越野</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="onlyLRT">
                            <label for="onlyLRT">仅轻轨</label>
                        </div>
                    </div>
                </div>
            </details>
        </div>
        
        <div id="resultContainer" class="result-container">
            <div class="result-header">
                <div class="result-title" id="resultTitle">查询结果</div>
                <div class="result-stats">
                    <div class="stat-item">
                        <div class="number" id="totalTime">-</div>
                        <div class="label">总用时</div>
                    </div>
                    <div class="stat-item">
                        <div class="number" id="ridingTime">-</div>
                        <div class="label">乘车时间</div>
                    </div>
                    <div class="stat-item">
                        <div class="number" id="transferCount">-</div>
                        <div class="label">换乘次数</div>
                    </div>
                </div>
            </div>
            <div id="routeList" class="route-list"></div>
        </div>
        
        <div class="quick-links">
            <a href="/stations" class="quick-link">
                <div class="icon">🚉</div>
                <h3>车站列表</h3>
                <p>查看所有车站</p>
            </a>
            <a href="/routes" class="quick-link">
                <div class="icon">🛤️</div>
                <h3>线路列表</h3>
                <p>查看所有线路</p>
            </a>
            <a href="/timetable" class="quick-link">
                <div class="icon">📅</div>
                <h3>时刻表查询</h3>
                <p>查询发车时刻</p>
            </a>
            <a href="/admin" class="quick-link">
                <div class="icon">⚙️</div>
                <h3>系统设置</h3>
                <p>管理配置</p>
            </a>
        </div>
    </div>
    
    <div class="footer">
        <p>MTR PathFinder | Powered by Flask</p>
        <p><a href="https://github.com/MTR-PathFinder" target="_blank">GitHub</a></p>
    </div>
    
    {% raw %}<script>
    function swapStations() {
        const start = document.getElementById('startStation');
        const end = document.getElementById('endStation');
        const temp = start.value;
        start.value = end.value;
        end.value = temp;
    }
    
    document.getElementById('startStation').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('endStation').focus();
        }
    });
    
    document.getElementById('endStation').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchRoute();
        }
    });
    
    async function searchRoute() {
        const start = document.getElementById('startStation').value.trim();
        const end = document.getElementById('endStation').value.trim();
        if (!start || !end) {
            alert('请输入起点和终点车站');
            return;
        }
        
        const mtrVersion = document.getElementById('mtrVersion').value;
        const searchMode = document.getElementById('searchMode').value;
        const maxWild = document.getElementById('maxWild').value;
        const departureTime = document.getElementById('departureTime').value;
        
        const options = {
            allow_high_speed: document.getElementById('allowHighSpeed').checked,
            allow_boat: document.getElementById('allowBoat').checked,
            allow_wild: document.getElementById('allowWild').checked,
            only_lrt: document.getElementById('onlyLRT').checked
        };
        
        try {
            const response = await fetch('/find-route', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    start: start,
                    end: end,
                    mtr_version: parseInt(mtrVersion),
                    search_mode: searchMode,
                    max_wild: parseInt(maxWild),
                    departure_time: departureTime || null,
                    options: options
                })
            });
            
            const data = await response.json();
            const container = document.getElementById('resultContainer');
            const routeList = document.getElementById('routeList');
            
            if (data.success) {
                container.classList.add('show');
                document.getElementById('resultTitle').textContent = `🚇 ${start} → ${end}`;
                document.getElementById('totalTime').textContent = data.total_time;
                document.getElementById('ridingTime').textContent = data.riding_time;
                document.getElementById('transferCount').textContent = data.transfer_count;
                
                let html = '';
                data.routes.forEach((route, index) => {
                    html += `
                    <div class="route-item">
                        <div class="route-header">
                            <div class="route-color" style="background-color: ${route.color}">${route.type_icon}</div>
                            <div class="route-info">
                                <div class="route-name">${route.name}</div>
                                <div class="route-time">${route.time}</div>
                            </div>
                        </div>
                        <div class="route-stations">
                            ${route.stations.map((sta, i) => 
                                `<span class="station-tag ${i === 0 ? 'start' : ''} ${i === route.stations.length - 1 ? 'end' : ''} ${sta.transfer ? 'transfer' : ''}">${sta.name}</span>`
                            ).join('')}
                        </div>
                    </div>`;
                });
                routeList.innerHTML = html;
            } else {
                container.classList.add('show');
                routeList.innerHTML = `
                <div class="no-result">
                    <div class="icon">❌</div>
                    <p>${data.message || '未找到路线，请检查车站名称是否正确'}</p>
                </div>`;
            }
        } catch (error) {
            console.error('查询失败:', error);
            alert('查询失败，请重试');
        }
    }
    </script>{% endraw %}
</body>
</html>
'''

TIMETABLE_CSS = '''
<style>
    :root {
        --primary: #4a90e2;
        --secondary: #50e3c2;
        --bg-dark: #1a1a2e;
        --bg-card: #16213e;
        --text: #e0e0e0;
        --border: #2a3a5a;
    }
    body {
        font-family: 'Segoe UI', 'Microsoft YaHei', Arial, sans-serif;
        background: var(--bg-dark);
        color: var(--text);
        margin: 0;
        min-height: 100vh;
    }
    header {
        background: linear-gradient(135deg, #16213e, #0f3460);
        padding: 15px 30px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }
    header h1 {
        font-size: 1.5rem;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    nav a {
        color: var(--text);
        text-decoration: none;
        margin-left: 20px;
        padding: 8px 16px;
        border-radius: 4px;
        transition: background 0.3s;
    }
    nav a:hover, nav a.active {
        background: rgba(74, 144, 226, 0.2);
    }
    .container {
        padding: 30px;
        max-width: 1400px;
        margin: 0 auto;
    }
    .search-section {
        background: var(--bg-card);
        border-radius: 8px;
        padding: 25px;
        margin-bottom: 25px;
        border: 1px solid var(--border);
    }
    .search-section h2 {
        margin-bottom: 20px;
    }
    .search-box {
        display: flex;
        gap: 15px;
        flex-wrap: wrap;
        margin-bottom: 20px;
    }
    .input-group {
        flex: 1;
        min-width: 250px;
        display: flex;
        align-items: center;
        background: rgba(26, 26, 46, 0.8);
        border-radius: 8px;
        padding: 12px 15px;
        border: 1px solid var(--border);
    }
    .input-group .icon {
        font-size: 1.25rem;
        margin-right: 10px;
    }
    .input-group input {
        flex: 1;
        background: transparent;
        border: none;
        color: var(--text);
        font-size: 1rem;
        outline: none;
    }
    .input-group input::placeholder {
        color: #666;
    }
    .btn {
        padding: 12px 30px;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
    }
    .btn-primary {
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        color: white;
    }
    .btn-primary:hover {
        opacity: 0.9;
    }
    .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .time-input {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .time-input input {
        padding: 12px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: rgba(26, 26, 46, 0.8);
        color: var(--text);
        font-size: 1rem;
    }
    .time-input input:focus {
        outline: none;
        border-color: var(--primary);
    }
    .results {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
        gap: 20px;
    }
    .route-card {
        background: var(--bg-card);
        border-radius: 8px;
        padding: 20px;
        border: 1px solid var(--border);
    }
    .route-header {
        display: flex;
        align-items: center;
        gap: 15px;
        margin-bottom: 15px;
        padding-bottom: 15px;
        border-bottom: 1px solid var(--border);
    }
    .route-color {
        width: 45px;
        height: 45px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        flex-shrink: 0;
    }
    .route-info h3 {
        margin-bottom: 5px;
    }
    .route-info p {
        color: #888;
        font-size: 0.875rem;
    }
    .station-list {
        max-height: 350px;
        overflow-y: auto;
    }
    .station-item {
        display: flex;
        align-items: flex-start;
        padding: 12px 0;
        border-bottom: 1px solid rgba(42, 58, 90, 0.5);
    }
    .station-item:last-child {
        border-bottom: none;
    }
    .station-time {
        width: 70px;
        flex-shrink: 0;
        font-weight: 600;
        color: var(--secondary);
    }
    .station-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--primary);
        margin: 5px 15px 0;
        flex-shrink: 0;
        position: relative;
    }
    .station-dot::before {
        content: '';
        position: absolute;
        top: 5px;
        left: 5px;
        width: 2px;
        height: calc(100% + 20px);
        background: var(--border);
        transform: translateX(-50%);
    }
    .station-item:last-child .station-dot::before {
        display: none;
    }
    .station-name {
        flex: 1;
    }
    .station-name .name {
        font-weight: 600;
        margin-bottom: 3px;
    }
    .station-name .info {
        font-size: 0.8rem;
        color: #888;
    }
    .no-data {
        text-align: center;
        padding: 50px;
        color: rgba(255,255,255,0.5);
        grid-column: 1 / -1;
    }
    @media (max-width: 768px) {
        header {
            flex-direction: column;
            gap: 10px;
        }
        .search-box {
            flex-direction: column;
        }
        .input-group {
            width: 100%;
        }
        .results {
            grid-template-columns: 1fr;
        }
    }
</style>
'''

TIMETABLE_HTML = '''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MTR路径查找器 - 时刻表查询</title>
    ''' + TIMETABLE_CSS + '''
    {% if config['UMAMI_SCRIPT_URL'] and config['UMAMI_WEBSITE_ID'] %}
    <script defer src="{{ config['UMAMI_SCRIPT_URL'] }}" data-website-id="{{ config['UMAMI_WEBSITE_ID'] }}"></script>
    {% endif %}
</head>
<body>
    <header>
        <h1>📅 时刻表查询</h1>
        <nav>
            <a href="/">🏠 首页</a>
            <a href="/stations">🚉 车站</a>
            <a href="/routes">🛤️ 线路</a>
            <a href="/admin">⚙️ 控制台</a>
        </nav>
    </header>
    
    <div class="container">
        <div class="search-section">
            <h2>🔍 搜索时刻表</h2>
            <div class="search-box">
                <div class="input-group">
                    <span class="icon">🚉</span>
                    <input type="text" id="stationInput" placeholder="输入车站名称或ID (例如: 香港 Hong Kong)">
                </div>
                <button class="btn btn-primary" onclick="searchStation()">查询</button>
            </div>
            <div class="time-input">
                <label for="queryTime">查询时间:</label>
                <input type="datetime-local" id="queryTime">
            </div>
        </div>
        
        <div id="resultsContainer" class="results"></div>
    </div>
    
    {% raw %}<script>
    document.getElementById('queryTime').value = new Date().toISOString().slice(0, 16);
    
    document.getElementById('stationInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchStation();
        }
    });
    
    async function searchStation() {
        const station = document.getElementById('stationInput').value.trim();
        if (!station) {
            alert('请输入车站名称');
            return;
        }
        
        const queryTime = document.getElementById('queryTime').value;
        const container = document.getElementById('resultsContainer');
        container.innerHTML = '<div class="no-data">正在查询...</div>';
        
        try {
            const response = await fetch('/api/timetable/station', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    station: station,
                    time: queryTime
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                let html = '';
                data.routes.forEach(route => {
                    const colorHex = '#' + route.route_color.toString(16).padStart(6, '0');
                    
                    html += `
                    <div class="route-card">
                        <div class="route-header">
                            <div class="route-color" style="background: ${colorHex}">
                                ${route.route_type.includes('light_rail') ? '🚊' : 
                                  route.route_type.includes('high_speed') ? '🚄' : 
                                  route.route_type.includes('boat') ? '🚢' : '🚇'}
                            </div>
                            <div class="route-info">
                                <h3>${route.route_name}</h3>
                                <p>第 ${route.station_position}/${route.total_stations} 站 | ${route.route_type_display}</p>
                            </div>
                        </div>
                        <div class="station-list">
                            ${route.prev_station ? `
                            <div class="station-item">
                                <div class="station-time">${route.prev_time}</div>
                                <div class="station-dot"></div>
                                <div class="station-name">
                                    <div class="name">${route.prev_station.name}</div>
                                    <div class="info">${route.prev_station.id}</div>
                                </div>
                            </div>
                            ` : ''}
                            <div class="station-item">
                                <div class="station-time">${route.current_time}</div>
                                <div class="station-dot"></div>
                                <div class="station-name">
                                    <div class="name">📍 ${route.station_name}</div>
                                    <div class="info">当前站 | ID: ${route.station_short_id}</div>
                                </div>
                            </div>
                            ${route.next_station ? `
                            <div class="station-item">
                                <div class="station-time">${route.next_time}</div>
                                <div class="station-dot"></div>
                                <div class="station-name">
                                    <div class="name">${route.next_station.name}</div>
                                    <div class="info">${route.next_station.id}</div>
                                </div>
                            </div>
                            ` : ''}
                        </div>
                    </div>`;
                });
                container.innerHTML = html;
            } else {
                container.innerHTML = `
                <div class="no-data">
                    <p>${data.message || '未找到该车站，请检查名称是否正确'}</p>
                </div>`;
            }
        } catch (error) {
            console.error('查询失败:', error);
            container.innerHTML = `
            <div class="no-data">
                <p>查询失败，请重试</p>
            </div>`;
        }
    }
    
    function showRouteTimetable(routeName) {
        window.location.href = '/timetable?route=' + encodeURIComponent(routeName);
    }
    </script>{% endraw %}
</body>
</html>
'''


def get_file_hash(filepath):
    try:
        with open(filepath, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()[:8]
    except:
        return 'N/A'


def load_config():
    global CONFIG
    config_file = 'config.json'
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                CONFIG = json.load(f)
        except:
            pass
    return CONFIG


def save_config():
    config_file = 'config.json'
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(CONFIG, f, indent=4, ensure_ascii=False)


def get_mtr_version():
    return CONFIG.get('mtr_version', 3)


def get_link():
    link = CONFIG.get('link', '').rstrip('/')
    if link.endswith('/index.html'):
        link = link.rsplit('/', 1)[0]
    return link


def get_data_files():
    link_hash = get_file_hash(CONFIG.get('link', '')) if CONFIG.get('link') else 'default'
    mtr_ver = get_mtr_version()
    
    if mtr_ver == 4:
        local_file = f'mtr-station-data-{link_hash}.json'
        interval_file = f'mtr-interval-data-{link_hash}.json'
        dep_file = f'mtr-departure-data-{link_hash}.json'
    else:
        local_file = f'mtr-station-data-{link_hash}-{mtr_ver}.json'
        interval_file = f'mtr-route-data-{link_hash}-{mtr_ver}.json'
        dep_file = None
    
    base_path = 'mtr_pathfinder_data'
    return local_file, interval_file, dep_file, base_path, base_path


def load_data_files():
    local_file, interval_file, dep_file, base_path, png_path = get_data_files()
    
    if os.path.exists(local_file):
        try:
            with open(local_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return None


def generate_route_color(color):
    if isinstance(color, str):
        if color.startswith('#'):
            return color
        try:
            return '#' + str(int(color)).zfill(6)
        except:
            return '#4a90e2'
    try:
        return '#' + str(color).zfill(6)
    except:
        return '#4a90e2'


def get_route_type_icon(route_type):
    if 'light_rail' in route_type:
        return '🚊'
    elif 'high_speed' in route_type:
        return '🚄'
    elif 'boat' in route_type:
        return '🚢'
    else:
        return '🚇'


def get_all_stations():
    data = load_data_files()
    if not data or 'stations' not in data[0]:
        return []
    
    stations = []
    for station_id, station_data in data[0]['stations'].items():
        if 'name' not in station_data:
            continue
        
        routes = []
        if 'connections' in station_data:
            for conn in station_data['connections']:
                for route in data[0]['routes']:
                    if any(s.get('id') == conn for s in route.get('stations', [])):
                        if route not in routes:
                            routes.append({
                                'name': route.get('name', 'Unknown'),
                                'type': route.get('type', 'train_normal')
                            })
        
        short_id = station_data.get('station', station_id)
        if isinstance(short_id, str) and short_id.startswith('0x'):
            short_id = str(int(short_id, 16))
        
        stations.append({
            'id': station_id,
            'name': station_data['name'].replace('|', ' '),
            'short_id': short_id,
            'routes': routes
        })
    
    return sorted(stations, key=lambda x: x['name'])


def get_all_routes():
    data = load_data_files()
    if not data or 'routes' not in data[0]:
        return []
    
    routes_dict = {}
    for route in data[0]['routes']:
        route_name = route.get('name', 'Unknown').split('|')[0]
        if route_name not in routes_dict:
            routes_dict[route_name] = {
                'name': route_name,
                'color': route.get('color', 0x4a90e2),
                'type': route.get('type', 'train_normal'),
                'directions': []
            }
        
        stations = [s.get('name', 'Unknown').replace('|', ' ') if isinstance(s, dict) else str(s).split('_')[-1] for s in route.get('stations', [])]
        color_hex = generate_route_color(route.get('color', 0x4a90e2))
        
        if route.get('circularState') == 'CLOCKWISE':
            direction = f"顺时针 (Clockwise) - {stations[-1] if stations else '终点'}"
        elif route.get('circularState') == 'ANTICLOCKWISE':
            direction = f"逆时针 (Anticlockwise) - {stations[-1] if stations else '终点'}"
        else:
            direction = f"{stations[0] if stations else '起点'} → {stations[-1] if stations else '终点'}"
        
        routes_dict[route_name]['directions'].append({
            'direction': direction,
            'stations': stations,
            'color': color_hex
        })
    
    return list(routes_dict.values())


def get_stats():
    data = load_data_files()
    if not data:
        return {'stations': 0, 'routes': 0, 'version': 'N/A'}
    
    stations_count = len(data[0].get('stations', {}))
    routes_count = len(data[0].get('routes', []))
    
    local_file, _, _, _, _ = get_data_files()
    version = 'N/A'
    try:
        if os.path.exists(local_file):
            version = strftime('%Y%m%d-%H%M', gmtime(os.path.getmtime(local_file)))
    except:
        pass
    
    return {
        'stations': stations_count,
        'routes': routes_count,
        'version': version
    }


def get_base_name(name):
    return name.split('|')[0] if isinstance(name, str) else str(name).split('|')[0]


def get_direction_name(stations, circular):
    if circular == 'CLOCKWISE':
        return f"顺时针 (Clockwise)"
    elif circular == 'ANTICLOCKWISE':
        return f"逆时针 (Anticlockwise)"
    else:
        return f"{get_base_name(stations[0]) if stations else '起点'} → {get_base_name(stations[-1]) if stations else '终点'}"


def process_time(seconds):
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    else:
        return f"{minutes:02d}:{secs:02d}"


def find_route_logic(start, end, mtr_version, search_mode, max_wild, departure_time, options):
    try:
        local_file, interval_file, dep_file, base_path, png_path = get_data_files()
        
        if not os.path.exists(local_file):
            return {'success': False, 'message': '未找到数据文件，请先更新数据'}
        
        mtr_ver = int(mtr_version)
        max_wild_blocks = int(max_wild) if max_wild else 1500
        
        calc_high_speed = options.get('allow_high_speed', True)
        calc_boat = options.get('allow_boat', True)
        calc_wild = options.get('allow_wild', False)
        only_lrt = options.get('only_lrt', False)
        
        link = get_link()
        
        if search_mode == 'realtime' and mtr_ver == 4:
            if departure_time:
                try:
                    dt = datetime.fromisoformat(departure_time.replace('T', ' '))
                    departure_timestamp = int(dt.timestamp())
                except:
                    departure_timestamp = None
            else:
                departure_timestamp = None
            
            result = mtr_pathfinder_v4.main(
                station1=start,
                station2=end,
                LINK=link,
                LOCAL_FILE_PATH=local_file,
                DEP_PATH=dep_file,
                BASE_PATH=base_path,
                PNG_PATH=png_path,
                MAX_WILD_BLOCKS=max_wild_blocks,
                STATION_TABLE=CONFIG.get('station_table', {}),
                ORIGINAL_IGNORED_LINES=CONFIG.get('ignored_lines', []),
                UPDATE_DATA=False,
                GEN_DEPARTURE=False,
                IGNORED_LINES=CONFIG.get('ignored_lines', []),
                AVOID_STATIONS=CONFIG.get('avoid_stations', []),
                CALCULATE_HIGH_SPEED=calc_high_speed,
                CALCULATE_BOAT=calc_boat,
                CALCULATE_WALKING_WILD=calc_wild,
                ONLY_LRT=only_lrt,
                DETAIL=False,
                MAX_HOUR=3,
                show=False,
                departure_time=departure_timestamp,
                timeout_min=2
            )
        else:
            in_theory = (search_mode == 'theory')
            
            result = mtr_pathfinder.main(
                station1=start,
                station2=end,
                LINK=link,
                LOCAL_FILE_PATH=local_file,
                INTERVAL_PATH=interval_file,
                BASE_PATH=base_path,
                PNG_PATH=png_path,
                MAX_WILD_BLOCKS=max_wild_blocks,
                STATION_TABLE=CONFIG.get('station_table', {}),
                ORIGINAL_IGNORED_LINES=CONFIG.get('ignored_lines', []),
                UPDATE_DATA=False,
                GEN_ROUTE_INTERVAL=False,
                IGNORED_LINES=CONFIG.get('ignored_lines', []),
                AVOID_STATIONS=CONFIG.get('avoid_stations', []),
                CALCULATE_HIGH_SPEED=calc_high_speed,
                CALCULATE_BOAT=calc_boat,
                CALCULATE_WALKING_WILD=calc_wild,
                ONLY_LRT=only_lrt,
                IN_THEORY=in_theory,
                DETAIL=False,
                MTR_VER=mtr_ver,
                show=False,
                cache=True
            )
        
        if result is None or result[0] is None:
            return {'success': False, 'message': '车站名称不正确或未找到'}
        elif result[0] is False:
            return {'success': False, 'message': '未找到路线'}
        elif result[0] == 'error':
            return {'success': False, 'message': '路线计算出错'}
        
        every_route_time = result[0] if isinstance(result, tuple) else result
        shortest_distance = result[1] if isinstance(result, tuple) else 0
        waiting_time = result[2] if isinstance(result, tuple) else 0
        riding_time = result[3] if isinstance(result, tuple) else 0
        
        routes = []
        for route_data in every_route_time:
            if len(route_data) >= 9:
                route = {
                    'name': route_data[3],
                    'color': route_data[2],
                    'type_icon': get_route_type_icon(route_data[8] if len(route_data) > 8 else 'train_normal'),
                    'time': f"乘车 {process_time(route_data[5])}" + (f" | 等待 {process_time(route_data[6])}" if route_data[6] > 0 else ""),
                    'stations': [
                        {'name': route_data[0], 'transfer': False},
                        {'name': route_data[1], 'transfer': False}
                    ]
                }
                routes.append(route)
        
        total_time = process_time(shortest_distance)
        riding_time_str = process_time(riding_time)
        
        transfer_count = len([r for r in routes if r['name'] not in ['Walk', '出站换乘步行 Walk']])
        
        return {
            'success': True,
            'routes': routes,
            'total_time': total_time,
            'riding_time': riding_time_str,
            'transfer_count': str(transfer_count)
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {'success': False, 'message': f'计算出错: {str(e)}'}


def update_data_logic(data_type):
    try:
        link = get_link()
        if not link:
            return {'success': False, 'message': '未配置线路图链接'}
        
        local_file, interval_file, dep_file, base_path, png_path = get_data_files()
        mtr_ver = get_mtr_version()
        
        if data_type == 'station':
            mtr_pathfinder.fetch_data(link, local_file, mtr_ver)
        elif data_type == 'interval':
            mtr_pathfinder.gen_route_interval(local_file, interval_file, link, mtr_ver)
        elif data_type == 'departure':
            if mtr_ver == 4 and dep_file:
                mtr_pathfinder_v4.gen_departure(link, dep_file)
            else:
                return {'success': False, 'message': '实时数据仅支持MTR 4.x'}
        
        return {'success': True, 'message': f'{data_type}数据更新成功'}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {'success': False, 'message': f'更新失败: {str(e)}'}


def get_station_timetable(station_name, query_time):
    try:
        data = load_data_files()
        if not data:
            return {'success': False, 'message': '未加载数据'}
        
        local_file, interval_file, dep_file, base_path, png_path = get_data_files()
        mtr_ver = get_mtr_version()
        
        station_id = mtr_pathfinder.station_name_to_id(data, station_name, CONFIG.get('station_table', {}))
        
        if not station_id:
            return {'success': False, 'message': '未找到车站'}
        
        station_data = data[0]['stations'].get(station_id, {})
        station_name = station_data.get('name', station_name).replace('|', ' ')
        short_id = station_data.get('station', station_id)
        
        if isinstance(short_id, str) and short_id.startswith('0x'):
            short_id = str(int(short_id, 16))
        
        routes = []
        if 'connections' in station_data:
            for conn in station_data['connections']:
                for route in data[0]['routes']:
                    for i, s in enumerate(route.get('stations', [])):
                        s_id = s.get('id') if isinstance(s, dict) else s
                        if s_id == conn:
                            stations_list = [st.get('name', 'Unknown').replace('|', ' ') if isinstance(st, dict) else str(st) for st in route.get('stations', [])]
                            stations_ids = [st.get('id') if isinstance(st, dict) else st for st in route.get('stations', [])]
                            
                            try:
                                position = stations_ids.index(station_id) + 1
                                total = len(stations_ids)
                            except:
                                position = 0
                                total = len(stations_ids)
                            
                            routes.append({
                                'route_name': route.get('name', 'Unknown').replace('|', ' '),
                                'route_color': route.get('color', 0x4a90e2),
                                'route_type': route.get('type', 'train_normal'),
                                'route_type_display': route.get('type', 'train_normal').replace('_', ' '),
                                'station_name': station_name,
                                'station_short_id': short_id,
                                'station_position': position,
                                'total_stations': total,
                                'prev_station': {
                                    'name': stations_list[position-2] if position > 1 else None,
                                    'id': f"ID: {stations_ids[position-2]}" if position > 1 else None
                                } if position > 1 else None,
                                'prev_time': '--:--',
                                'current_time': query_time.strftime('%H:%M') if query_time else datetime.now().strftime('%H:%M'),
                                'next_station': {
                                    'name': stations_list[position] if position < total else None,
                                    'id': f"ID: {stations_ids[position]}" if position < total else None
                                } if position < total else None,
                                'next_time': '--:--'
                            })
                            break
        
        return {
            'success': True if routes else False,
            'routes': routes,
            'station_name': station_name,
            'station_short_id': short_id
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {'success': False, 'message': f'查询失败: {str(e)}'}


@app.route('/')
def index():
    load_config()
    return render_template_string(INDEX_HTML, config=CONFIG)


@app.route('/stations')
def stations_list():
    load_config()
    stations = get_all_stations()
    count = len(stations)
    return render_template_string(STATIONS_HTML, stations=stations, count=count, config=CONFIG)


@app.route('/routes')
def routes_list():
    load_config()
    route_groups = get_all_routes()
    count = len(route_groups)
    return render_template_string(ROUTES_HTML, route_groups=route_groups, count=count, config=CONFIG)


@app.route('/find-route', methods=['POST'])
def find_route():
    load_config()
    try:
        data = request.get_json()
        start = data.get('start', '')
        end = data.get('end', '')
        mtr_version = data.get('mtr_version', 3)
        search_mode = data.get('search_mode', 'waiting')
        max_wild = data.get('max_wild', 1500)
        departure_time = data.get('departure_time', None)
        options = data.get('options', {})
        
        if not start or not end:
            return jsonify({'success': False, 'message': '请输入起点和终点'})
        
        result = find_route_logic(start, end, mtr_version, search_mode, max_wild, departure_time, options)
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'请求处理失败: {str(e)}'})


@app.route('/data/<filename>')
def serve_file(filename):
    try:
        local_file, interval_file, dep_file, base_path, png_path = get_data_files()
        safe_path = os.path.join(base_path, filename)
        if os.path.exists(safe_path):
            return send_file(safe_path)
        return send_file(os.path.join('mtr_pathfinder_data', filename))
    except:
        return jsonify({'error': '文件不存在'}), 404


from flask import send_file


@app.route('/admin')
def admin():
    load_config()
    if 'logged_in' not in session:
        return render_template_string(LOGIN_HTML, config=CONFIG)
    
    stats = get_stats()
    return render_template_string(ADMIN_HTML, config=CONFIG, stats=stats)


@app.route('/admin', methods=['POST'])
def admin_login():
    load_config()
    username = request.form.get('username', '')
    password = request.form.get('password', '')
    
    if username == CONFIG.get('admin_username', 'admin') and password == CONFIG.get('admin_password', 'admin123'):
        session['logged_in'] = True
        return redirect('/admin')
    else:
        return render_template_string(LOGIN_HTML, error='用户名或密码错误', config=CONFIG)


@app.route('/admin/login-ajax', methods=['POST'])
def admin_login_ajax():
    load_config()
    try:
        data = request.get_json()
        username = data.get('username', '')
        password = data.get('password', '')
        
        if username == CONFIG.get('admin_username', 'admin') and password == CONFIG.get('admin_password', 'admin123'):
            session['logged_in'] = True
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'message': '用户名或密码错误'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/admin/logout')
def admin_logout():
    session.pop('logged_in', None)
    return redirect('/')


@app.route('/admin/update-config-ajax', methods=['POST'])
def update_config_ajax():
    load_config()
    try:
        data = request.get_json()
        
        CONFIG['mtr_version'] = data.get('mtr_version', 3)
        CONFIG['link'] = data.get('link', '')
        CONFIG['MAX_WILD_BLOCKS'] = data.get('max_wild_blocks', 1500)
        CONFIG['admin_username'] = data.get('admin_username', 'admin')
        
        if data.get('admin_password'):
            CONFIG['admin_password'] = data.get('admin_password')
        
        CONFIG['calculate_high_speed'] = data.get('calculate_high_speed', True)
        CONFIG['calculate_boat'] = data.get('calculate_boat', True)
        CONFIG['calculate_wild'] = data.get('calculate_wild', False)
        CONFIG['only_lrt'] = data.get('only_lrt', False)
        
        ignored = data.get('ignored_lines', [])
        if isinstance(ignored, str):
            ignored = [line.strip() for line in ignored.split('\n') if line.strip()]
        CONFIG['ignored_lines'] = ignored
        
        avoid = data.get('avoid_stations', [])
        if isinstance(avoid, str):
            avoid = [line.strip() for line in avoid.split('\n') if line.strip()]
        CONFIG['avoid_stations'] = avoid
        
        save_config()
        
        return jsonify({'success': True})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)})


@app.route('/admin/update-data-ajax', methods=['POST'])
def update_data_ajax():
    load_config()
    try:
        data = request.get_json()
        data_type = data.get('type', 'station')
        result = update_data_logic(data_type)
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/stats')
def api_stats():
    load_config()
    stats = get_stats()
    return jsonify(stats)


@app.route('/api/stations')
def api_stations():
    load_config()
    stations = get_all_stations()
    return jsonify(stations)


@app.route('/api/routes')
def api_routes():
    load_config()
    routes = get_all_routes()
    return jsonify(routes)


@app.route('/timetable')
def timetable():
    load_config()
    return render_template_string(TIMETABLE_HTML, config=CONFIG)


@app.route('/api/timetable/station', methods=['POST'])
def api_timetable_station():
    load_config()
    try:
        data = request.get_json()
        station_name = data.get('station', '')
        query_time_str = data.get('time', '')
        
        if not station_name:
            return jsonify({'success': False, 'message': '请输入车站名称'})
        
        try:
            if query_time_str:
                query_time = datetime.strptime(query_time_str, '%Y-%m-%dT%H:%M')
            else:
                query_time = datetime.now()
        except:
            query_time = datetime.now()
        
        result = get_station_timetable(station_name, query_time)
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'查询失败: {str(e)}'})


if __name__ == '__main__':
    import sys
    
    port = 5000
    host = '0.0.0.0'
    debug = False
    
    for i, arg in enumerate(sys.argv):
        if arg == '--port' and i + 1 < len(sys.argv):
            try:
                port = int(sys.argv[i + 1])
            except:
                pass
        elif arg == '--host' and i + 1 < len(sys.argv):
            host = sys.argv[i + 1]
        elif arg == '--debug':
            debug = True
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                   MTR 路径查找器 - WebUI                      ║
╠══════════════════════════════════════════════════════════════╣
║  服务已启动!                                                  ║
║                                                              ║
║  本地访问: http://localhost:{port}                             ║
║  网络访问: http://{host}:{port}                                ║
║                                                              ║
║  按 Ctrl+C 停止服务                                           ║
╚══════════════════════════════════════════════════════════════╝
    """)
    
    app.run(host=host, port=port, debug=debug, threaded=True)
