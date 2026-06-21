/**
 * 生成示例 MTR 数据（用于首次运行和测试）
 *
 * 实际使用时: 从 MTR 存档中导出 stations_routes_data.json 即可
 * 格式要求:
 *   {
 *     dim_id: 'overworld',
 *     stations: { station_id: { name: '中环|Central', color: 0xRRGGBB, x, z, connections: [] } },
 *     routes:   { route_id:   { name: '港岛线||Island Line', color, type: 'train_normal', stations: [...], durations: [...] } },
 *     positions: { platform_id: { x, y } }
 *   }
 */

import fs from 'node:fs';
import path from 'node:path';

function main() {
  const stations: Record<string, any> = {};
  const routes: Record<string, any> = {};
  const positions: Record<string, any> = {};

  // 10 条线路 × 若干站
  const lineDefs = [
    { name: '港岛线|Island Line', color: 0x007dc5, type: 'train_normal', stations: ['堅尼地城|Kennedy Town', '香港大學|HKU', '上環|Sheung Wan', '中環|Central', '金鐘|Admiralty', '灣仔|Wan Chai', '銅鑼灣|Causeway Bay', '天后|Tin Hau', '炮台山|Fortress Hill', '北角|North Point', '鰂魚涌|Quarry Bay', '太古|Tai Koo', '西灣河|Sai Wan Ho', '筲箕灣|Shau Kei Wan', '杏花邨|Heng Fa Chuen', '柴灣|Chai Wan'] },
    { name: '荃灣綫|Tsuen Wan Line', color: 0xe60012, type: 'train_normal', stations: ['中環|Central', '金鐘|Admiralty', '尖沙咀|Tsim Sha Tsui', '佐敦|Jordan', '油麻地|Yau Ma Tei', '旺角|Mong Kok', '太子|Prince Edward', '深水埗|Sham Shui Po', '長沙灣|Cheung Sha Wan', '荔枝角|Lai Chi Kok', '美孚|Mei Foo', '荔景|Lai King', '葵芳|Kwai Fong', '葵興|Kwai Hing', '大窩口|Tai Wo Hau', '荃灣|Tsuen Wan'] },
    { name: '觀塘綫|Kwun Tong Line', color: 0x00ab4e, type: 'train_normal', stations: ['調景嶺|Tiu Keng Leng', '將軍澳|Tseung Kwan O', '坑口|Hang Hau', '寶琳|Po Lam', '北角|North Point', '鰂魚涌|Quarry Bay', '太古|Tai Koo', '西灣河|Sai Wan Ho', '筲箕灣|Shau Kei Wan', '杏花邨|Heng Fa Chuen', '柴灣|Chai Wan'] },
    { name: '機場快綫|Airport Express', color: 0x00888a, type: 'train_high_speed', stations: ['中環|Central', '香港|Hong Kong', '九龍|Kowloon', '青衣|Tsing Yi', '機場|Airport', '博覽館|AsiaWorld-Expo'] },
    { name: '東涌綫|Tung Chung Line', color: 0xf39826, type: 'train_normal', stations: ['香港|Hong Kong', '九龍|Kowloon', '奧運|Olympic', '南昌|Nam Cheong', '荔景|Lai King', '葵芳|Kwai Fong', '青衣|Tsing Yi', '欣澳|Sunny Bay', '東涌|Tung Chung'] },
    { name: '迪士尼綫|Disneyland Resort Line', color: 0xebc72f, type: 'train_normal', stations: ['欣澳|Sunny Bay', '迪士尼|Disneyland Resort'] },
    { name: '南港島綫|South Island Line', color: 0x6f2a8a, type: 'train_normal', stations: ['金鐘|Admiralty', '海洋公園|Ocean Park', '黃竹坑|Wong Chuk Hang', '利東|Lei Tung', '海怡半島|South Horizons'] },
    { name: '東鐵綫|East Rail Line', color: 0x53b7e8, type: 'train_normal', stations: ['金鐘|Admiralty', '灣仔|Wan Chai', '會展|Exhibition Centre', '紅磡|Hung Hom', '旺角東|Mong Kok East', '九龍塘|Kowloon Tong', '大圍|Tai Wai', '沙田|Sha Tin', '火炭|Fo Tan', '大學|University', '大埔墟|Tai Po Market', '太和|Tai Wo', '粉嶺|Fanling', '上水|Sheung Shui', '落馬洲|Lok Ma Chau', '羅湖|Lo Wu'] },
    { name: '將軍澳綫|Tseung Kwan O Line', color: 0x8b5c2b, type: 'train_normal', stations: ['北角|North Point', '鰂魚涌|Quarry Bay', '油塘|Yau Tong', '調景嶺|Tiu Keng Leng', '將軍澳|Tseung Kwan O', '坑口|Hang Hau', '寶琳|Po Lam', '康城|LOHAS Park'] },
    { name: '屯馬綫|Tuen Ma Line', color: 0x873528, type: 'train_light_rail', stations: ['烏溪沙|Wu Kai Sha', '馬鞍山|Ma On Shan', '恆安|Heng On', '大水坑|Tai Shui Hang', '石門|Shek Mun', '第一城|City One', '沙田圍|Sha Tin Wai', '車公廟|Che Kung Temple', '大圍|Tai Wai', '顯徑|Hin Keng', '鑽石山|Diamond Hill', '啟德|Kai Tak', '宋皇臺|Sung Wong Toi', '土瓜灣|To Kwa Wan', '何文田|Ho Man Tin', '紅磡|Hung Hom'] },
  ];

  // 分配坐标：给每条线路的车站一个递增的 x 坐标
  // 不同线路的车站如果名字相同应该复用同一个 station_id
  const stationNameToId = new Map<string, string>();
  let nextStationIdx = 1;

  lineDefs.forEach((line, lineIdx) => {
    const yBase = lineIdx * 80 + 50;
    // 先收集车站（处理换乘站共用 id）
    const stationIds: string[] = [];
    for (let i = 0; i < line.stations.length; i++) {
      const name = line.stations[i];
      if (!stationNameToId.has(name)) {
        const id = `station_${nextStationIdx++}`;
        stationNameToId.set(name, id);
        // 坐标: x 基于线路内索引, y 基于线路编号
        const x = i * 100 + 50;
        const z = yBase + (lineIdx % 2 === 0 ? 0 : 40);
        stations[id] = {
          name,
          color: line.color,
          x,
          z,
          connections: [],
        };
      }
      stationIds.push(stationNameToId.get(name)!);
    }

    // 创建 route
    const routeId = `route_${lineIdx + 1}`;
    const durations = line.stations.slice(1).map(() => 20 * 30); // 每段 30 秒
    routes[routeId] = {
      name: line.name,
      number: `${lineIdx + 1}|${lineIdx + 1}`,
      color: line.color,
      type: line.type,
      circular: false,
      stations: stationIds,
      durations,
    };

    // 创建站台位置
    for (let i = 0; i < stationIds.length; i++) {
      const platformId = `${stationIds[i]}_${i}`;
      positions[platformId] = {
        x: stations[stationIds[i]].x,
        y: stations[stationIds[i]].z + (lineIdx % 2 === 0 ? 5 : -5),
      };
    }
  });

  // 添加一些换乘连接（同名车站的双向连接）
  // 简单起见: 所有同名车站互相连接
  const nameToIds = new Map<string, string[]>();
  for (const [id, st] of Object.entries(stations)) {
    const namePart = st.name.split('|')[0];
    if (!nameToIds.has(namePart)) nameToIds.set(namePart, []);
    nameToIds.get(namePart)!.push(id);
  }

  // 最终输出格式
  const output = [
    {
      dim_id: 'overworld',
      stations,
      routes,
      positions,
    },
  ];

  const outputDir = path.resolve(process.cwd(), 'public', 'data');
  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'stations_routes.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`✅ 已生成示例数据: ${outPath}`);
  console.log(`   ${Object.keys(stations).length} 个车站, ${Object.keys(routes).length} 条线路`);
  console.log(`   ${Object.keys(positions).length} 个站台`);
}

main();
