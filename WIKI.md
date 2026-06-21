# MTR Pathfinder 项目维基文档

## 目录

1. [项目概述](#项目概述)
2. [整体架构](#整体架构)
3. [主要模块职责](#主要模块职责)
4. [关键类和函数](#关键类和函数)
5. [数据流程](#数据流程)
6. [依赖关系](#依赖关系)
7. [配置说明](#配置说明)
8. [运行项目](#运行项目)
9. [API 接口文档](#api-接口文档)

---

## 项目概述

**MTR Pathfinder** 是一个基于 Flask 的 Web 应用程序，用于为 Minecraft Transit Railway (MTR) 模组提供路径规划和时刻表查询功能。该项目支持 MTR 模组的两个主要版本（v3 和 v4），提供实时寻路、理论寻路、车站/线路信息查询以及时刻表查询等功能。

### 核心功能

- **路径规划**：支持实时寻路和理论寻路两种模式
- **车站信息**：查询车站详情、经过线路、连接车站等
- **线路信息**：查询线路详情、站点列表、运行时间等
- **时刻表查询**：查询车站发车时刻、列车时刻表
- **管理控制台**：数据更新、配置管理

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层 (Templates)                     │
│  index.html, stations.html, routes.html, timetable.html... │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Web 层 (main.py)                        │
│                    Flask 路由和控制器                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    业务逻辑层 (mtr_pathfinder_lib)            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ mtr_pathfinder  │  │mtr_pathfinder_v4│  │mtr_timetable │ │
│  │    (v3 寻路)     │  │   (v4 实时寻路)  │  │  (时刻表)     │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      数据层 (JSON/Pickle)                     │
│   车站数据、线路数据、发车数据、时刻表数据、缓存数据            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    外部数据源 (MTR API)                       │
│         Minecraft Transit Railway 在线地图 API               │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

```
/workspace/
├── main.py                      # Flask 主应用入口
├── requirements.txt             # Python 依赖
├── config.json                  # 配置文件（运行时生成）
├── Dockerfile                   # Docker 构建文件
├── zbpack.json                  # 构建配置
│
├── mtr_pathfinder_lib/          # 核心业务逻辑库
│   ├── mtr_pathfinder.py        # MTR v3 寻路模块
│   ├── mtr_pathfinder_v4.py     # MTR v4 实时寻路模块
│   ├── mtr_timetable.py         # 时刻表模块
│   └── test_*.py                # 测试文件
│
├── templates/                   # HTML 模板
│   ├── base.html                # 基础模板
│   ├── index.html               # 首页
│   ├── stations.html            # 车站列表
│   ├── station_detail.html      # 车站详情
│   ├── routes.html              # 线路列表
│   ├── route_detail.html        # 线路详情
│   ├── timetable.html           # 时刻表页面
│   ├── admin.html               # 管理控制台
│   └── *.htm                    # 时刻表子模板
│
├── static/                      # 静态资源
│   ├── styles.css               # 主样式
│   ├── station_*.css            # 车站页面样式
│   ├── direction_*.css          # 方向页面样式
│   └── train_*.css              # 列车页面样式
│
└── mtr_pathfinder_data/         # 数据资源
    ├── fonts/                   # 多语言字体
    └── *.png                    # 交通工具图标
```

---

## 主要模块职责

### 1. main.py - Web 应用主入口

**职责**：
- Flask 应用初始化和配置
- 路由定义和请求处理
- 配置加载和保存
- 数据自动检查和生成
- API 接口实现

**核心功能**：
- 页面路由：首页、车站列表、线路列表、时刻表等
- API 接口：寻路、车站搜索、数据更新等
- 管理功能：配置管理、缓存清理

### 2. mtr_pathfinder.py - MTR v3 寻路模块

**职责**：
- MTR 3.x 版本的路径规划
- 基于发车间隔的理论寻路
- 图结构构建和最短路径计算
- 路线图片生成

**核心算法**：
- 使用 NetworkX 构建车站图
- Dijkstra 最短路径算法
- 发车间隔计算（LCM 合并）

### 3. mtr_pathfinder_v4.py - MTR v4 实时寻路模块

**职责**：
- MTR 4.x 版本的实时路径规划
- 基于实际发车时间的 CSA 算法
- 时刻表生成和处理
- 实时路线图片生成

**核心算法**：
- Connection Scan Algorithm (CSA)
- 实时发车数据处理
- 换乘时间计算

### 4. mtr_timetable.py - 时刻表模块

**职责**：
- 车站时刻表生成
- 列车时刻表查询
- 方向分组和显示
- HTML 模板渲染

---

## 关键类和函数

### 枚举类

#### RouteType (mtr_pathfinder.py)
```python
class RouteType(Enum):
    IN_THEORY = 0    # 理论寻路（不考虑等车时间）
    WAITING = 1      # 等待寻路（考虑发车间隔）
```

#### RouteType (mtr_pathfinder_v4.py)
```python
class RouteType(Enum):
    IN_THEORY = 0    # 理论寻路
    WAITING = 1      # 等待寻路
    REAL_TIME = 2    # 实时寻路
```

#### ImagePattern (图片绘制模式)
```python
class ImagePattern(Enum):
    OR = 0                    # "或" 标记
    FAKE_STATION = 1          # 虚拟站点
    TEXT = 40.2               # 普通文本
    STATION = 40              # 车站圆圈
    THUMB_TEXT = 60           # 缩略图+文本
    THUMB_INTEND_TEXT = 80    # 缩进缩略图+文本
    GREY_TEXT = 40.1          # 灰色文本
    GREY_INTEND_TEXT = 60.1   # 缩进灰色文本
```

### 核心类

#### CSA (Connection Scan Algorithm)
```python
class CSA:
    def __init__(self, max_stations, connections, timeout_min=2):
        self.in_connection = array('L')      # 入边连接
        self.earliest_arrival = array('L')   # 最早到达时间
        self.connections = connections        # 连接列表
    
    def compute(self, departure_station, arrival_station, departure_time):
        """计算从出发站到到达站的最优路径"""
```

### 核心函数

#### mtr_pathfinder.py

| 函数名 | 描述 |
|--------|------|
| `main()` | 主入口函数，执行寻路并返回结果 |
| `fetch_data()` | 从 MTR API 获取车站和线路数据 |
| `create_graph()` | 构建车站图（NetworkX MultiDiGraph） |
| `find_shortest_route()` | 查找最短路径 |
| `process_path()` | 处理路径结果，转换为可读格式 |
| `save_image()` | 生成路线结果图片 |
| `gen_route_interval()` | 生成发车间隔数据 |
| `station_name_to_id()` | 车站名称转 ID（支持模糊匹配） |

#### mtr_pathfinder_v4.py

| 函数名 | 描述 |
|--------|------|
| `main()` | 主入口函数，执行实时寻路 |
| `fetch_data()` | 获取 v4 格式的车站和线路数据 |
| `gen_timetable()` | 生成时刻表连接数据 |
| `load_tt()` | 加载时刻表并添加换乘连接 |
| `process_path()` | 处理 CSA 算法结果 |
| `gen_departure()` | 下载发车数据 |

#### mtr_timetable.py

| 函数名 | 描述 |
|--------|------|
| `get_sta_directions()` | 获取车站所有方向 |
| `get_sta_timetable()` | 获取车站时刻表 |
| `get_train()` | 获取列车详细信息 |
| `get_text_timetable()` | 获取文本格式时刻表 |
| `random_train()` | 随机选择一趟列车 |
| `station_name_to_id()` | 车站名称转 ID |
| `station_short_id_to_id()` | 车站短代码转 ID |

#### main.py

| 函数名 | 路由 | 描述 |
|--------|------|------|
| `index()` | `/` | 首页 |
| `stations()` | `/stations` | 车站列表 |
| `station_detail()` | `/stations/<id>` | 车站详情 |
| `routes()` | `/routes` | 线路列表 |
| `route_detail()` | `/routes/<id>` | 线路详情 |
| `api_find_route()` | `/api/find_route` | 寻路 API |
| `api_timetable()` | `/api/timetable` | 时刻表 API |
| `api_update_data()` | `/api/update_data` | 数据更新 API |
| `api_search_stations()` | `/api/search_stations` | 车站搜索 API |

---

## 数据流程

### 寻路数据流程

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MTR API     │────▶│  fetch_data  │────▶│ JSON 数据文件 │
│ (在线地图)    │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   寻路请求    │────▶│ create_graph │────▶│ NetworkX 图  │
│              │     │  /gen_timetable│    │              │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  结果图片    │◀────│ process_path │◀────│ find_shortest│
│  (Base64)    │     │ save_image   │     │   _route     │
└──────────────┘     └──────────────┘     └──────────────┘
```

### 数据文件说明

| 文件名 | 格式 | 描述 |
|--------|------|------|
| `mtr-original-data-*-v3.json` | JSON | v3 格式车站和线路数据 |
| `mtr-original-data-*-v4.json` | JSON | v4 格式车站和线路数据 |
| `mtr-route-interval-*-v3.json` | JSON | 发车间隔数据 |
| `mtr-route-departure-*-v4.json` | JSON | 实时发车数据 |
| `station_timetable_data.dat` | Pickle | 车站时刻表数据 |
| `train_timetable_data.dat` | Pickle | 列车时刻表数据 |
| `mtr_pathfinder_temp/*.dat` | Pickle | 寻路缓存数据 |

---

## 依赖关系

### Python 依赖 (requirements.txt)

```
Flask          # Web 框架
fonttools      # 字体处理
networkx       # 图算法库
OpenCC==1.1.1  # 中文繁简转换
Pillow         # 图像处理
Requests       # HTTP 请求
```

### 系统依赖

- `libraqm-dev` - 复杂文本布局支持
- `libfribidi-dev` - 双向文本支持
- `libharfbuzz-dev` - 文本整形引擎

### 内部模块依赖关系

```
main.py
    ├── mtr_pathfinder_lib.mtr_pathfinder (v3)
    │       ├── networkx (图算法)
    │       ├── PIL (图像生成)
    │       ├── opencc (中文转换)
    │       └── requests (API 请求)
    │
    ├── mtr_pathfinder_lib.mtr_pathfinder_v4 (v4)
    │       ├── CSA 算法实现
    │       ├── PIL (图像生成)
    │       └── requests (API 请求)
    │
    └── mtr_pathfinder_lib.mtr_timetable
            ├── opencc (中文转换)
            └── pickle (数据序列化)
```

---

## 配置说明

### 环境变量配置

| 环境变量 | 默认值 | 类型 | 描述 |
|---------|--------|------|------|
| `LINK` | `https://letsplay.minecrafttransitrailway.com/system-map` | 字符串 | MTR 模组在线线路图网址 |
| `MTR_VER` | `4` | 整数 | MTR 模组版本（3 或 4） |
| `MAX_HOUR` | `3` | 整数 | 旅途的最长时间（仅适用于 v4 实时寻路） |
| `MAX_WILD_BLOCKS` | `1500` | 整数 | 非出站换乘（越野）的最远步行距离 |
| `TRANSFER_ADDITION` | `{}` | 对象 | 手动增加出站换乘 |
| `WILD_ADDITION` | `{}` | 对象 | 手动增加非出站换乘 |
| `STATION_TABLE` | `{}` | 对象 | 车站昵称到实际名称的映射 |
| `ORIGINAL_IGNORED_LINES` | `[]` | 数组 | 未开通或禁止乘坐的路线列表 |
| `CONSOLE_PASSWORD` | `admin` | 字符串 | 管理员控制台密码 |
| `UMAMI_SCRIPT_URL` | `''` | 字符串 | Umami 分析脚本 URL |
| `UMAMI_WEBSITE_ID` | `''` | 字符串 | Umami 网站 ID |

### 配置文件示例 (config.json)

```json
{
    "LINK": "https://example.com/system-map",
    "MTR_VER": 4,
    "MAX_HOUR": 3,
    "MAX_WILD_BLOCKS": 1500,
    "TRANSFER_ADDITION": {
        "车站A": ["车站B", "车站C"]
    },
    "WILD_ADDITION": {
        "车站X": ["车站Y"]
    },
    "STATION_TABLE": {
        "昵称": "实际名称"
    },
    "ORIGINAL_IGNORED_LINES": ["未开通线路"],
    "CONSOLE_PASSWORD": "your_password"
}
```

---

## 运行项目

### 本地开发环境

1. **安装依赖**
```bash
pip install -r requirements.txt
```

2. **设置环境变量**（可选）
```bash
export LINK="https://your-mtr-map-url.com/system-map"
export MTR_VER=4
```

3. **运行应用**
```bash
python main.py
# 或
flask run
```

4. **访问应用**
- 主页：http://localhost:5000
- 管理控制台：http://localhost:5000/admin

### Docker 部署

1. **构建镜像**
```bash
docker build -t mtr-pathfinder .
```

2. **运行容器**
```bash
docker run -d \
    -p 5000:5000 \
    -e LINK="https://your-mtr-map-url.com/system-map" \
    -e CONSOLE_PASSWORD="your_password" \
    mtr-pathfinder
```

### 生产环境建议

- 使用 Gunicorn 或 uWSGI 作为 WSGI 服务器
- 配置 Nginx 作为反向代理
- 启用 HTTPS
- 设置适当的缓存策略

---

## API 接口文档

### 1. 寻路接口

**POST** `/api/find_route`

**请求体**：
```json
{
    "start": "起点站名称",
    "end": "终点站名称",
    "algorithm": "default|real|theory",
    "dep_time": 36000,
    "ignored_lines": ["线路1"],
    "only_lines": [],
    "avoid_stations": [],
    "disable_high_speed": false,
    "disable_boat": false,
    "enable_wild": false,
    "only_lrt": false,
    "detail": true
}
```

**响应**：
```json
{
    "result": [
        总用时,
        ["车站列表"],
        [路线详情],
        乘车时间,
        等车时间
    ],
    "algorithm": "real",
    "calc_time": 0.5,
    "used_cache": false,
    "data_versions": {
        "station_version": "20240101-1200",
        "station_version_v4": "20240101-1200",
        "route_version_v4": "20240101-1200",
        "interval_version": "20240101-1200"
    },
    "image_base64": "data:image/png;base64,..."
}
```

### 2. 车站搜索接口

**GET** `/api/search_stations?q=关键词`

**响应**：
```json
["车站1|Station1", "车站2|Station2", ...]
```

### 3. 时刻表接口

**POST** `/api/timetable`

**请求体**：
```json
{
    "station": "车站名称或ID",
    "route": "线路名称",
    "direction": 1,
    "time": "08:00:00",
    "text_mode": false
}
```

### 4. 数据更新接口

**POST** `/api/update_data`

**响应**：
```json
{
    "success": true
}
```

### 5. 进度查询接口

**GET** `/api/progress` - 寻路进度

**GET** `/api/update_progress` - 数据更新进度

**响应**：
```json
{
    "percentage": 50,
    "stage": "寻路计算"
}
```

### 6. 缓存管理接口

**POST** `/api/clear_cache` - 清除寻路缓存

**POST** `/api/clear_images` - 清除结果图片

---

## 常量说明

### 交通工具平均速度

```python
DEFAULT_AVERAGE_SPEED = {
    'train_normal': 14,       # 普通列车: 14 block/s
    'train_light_rail': 11,   # 轻轨: 11 block/s
    'train_high_speed': 40,   # 高铁: 40 block/s
    'boat_normal': 10,        # 普通船: 10 block/s
    'boat_light_rail': 10,    # 轻轨船: 10 block/s
    'boat_high_speed': 13,    # 高速船: 13 block/s
    'cable_car_normal': 8,    # 缆车: 8 block/s
    'airplane_normal': 70     # 飞机: 70 block/s
}
```

### 步行速度

```python
RUNNING_SPEED = 5.612        # 站内换乘速度 (block/s)
TRANSFER_SPEED = 4.317       # 出站换乘速度 (block/s)
WILD_WALKING_SPEED = 2.25    # 越野步行速度 (block/s)
```

---

## 扩展开发指南

### 添加新的交通工具类型

1. 在 `DEFAULT_AVERAGE_SPEED` 字典中添加新类型和速度
2. 在 `mtr_pathfinder_data/` 目录添加对应的图标文件
3. 更新 `ImagePattern` 处理逻辑

### 添加新的 API 接口

1. 在 `main.py` 中定义路由函数
2. 使用 `@app.route()` 装饰器
3. 返回 JSON 格式响应

### 自定义图片样式

1. 修改 `save_image()` 和 `generate_image()` 函数
2. 调整 `ImagePattern` 枚举值
3. 更新字体文件和颜色配置

---

## 版本信息

- **项目版本**: 基于 mtr_pathfinder v130
- **支持 MTR 版本**: 3.x 和 4.x
- **Python 版本**: 3.8+
- **Flask 版本**: 最新稳定版

---

## 许可证

请参考项目根目录的 LICENSE 文件。
