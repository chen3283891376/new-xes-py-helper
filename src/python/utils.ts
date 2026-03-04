import { spawn } from 'bun';
import { platform } from 'os';

export function analyzePythonError(errorOutput: string): {
	missingModule?: string;
	suggestedCommand?: string;
} {
	const error = errorOutput.trim();

	// 模式匹配
	const patterns = [
		// ModuleNotFoundError: No module named 'xxx'
		/ModuleNotFoundError.*?: No module named ['"]([^'"]+)['"]/,
		/ImportError.*?: No module named ['"]([^'"]+)['"]/,
		// cannot import name 'xxx' from 'yyy'
		/ImportError.*?: cannot import name ['"]([^'"]+)['"]/,
		// DLL load failed while importing xxx
		/DLL load failed while importing ['"]([^'"]+)['"]/,
	];

	for (const pattern of patterns) {
		const match = error.match(pattern);
		if (match && match[1]) {
			return {
				missingModule: match[1],
				suggestedCommand: `pip install ${match[1]}`,
			};
		}
	}

	return {};
}
export async function getLocalPythonInterpreters(): Promise<
	{
		name: string;
		value: string;
	}[]
> {
	const results = new Set<string>();
	const isWin = platform() === 'win32';

	const command = isWin ? 'where' : 'which';
	const args = isWin ? ['python'] : ['python3', '-a'];

	const proc = spawn([command, ...args], {
		stdout: 'pipe',
		stderr: 'ignore',
	});
	await proc.exited;
	const out = await new Response(proc.stdout).text();
	const lines = out.split('\n');
	for (const line of lines) {
		if (line.trim().length > 0) {
			results.add(line.trim());
		}
	}

	const list: { name: string; value: string }[] = [];

	for (const p of results) {
		try {
			const proc = spawn([p, '--version'], {
				stdout: 'pipe',
				stderr: 'pipe',
			});
			await proc.exited;
			const out = await new Response(proc.stdout).text();
			const err = await new Response(proc.stderr).text();
			const version = (out + err).trim().replace('Python ', '');

			const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
			const shortPath = p.replace(home, '~');

			list.push({
				name: `Python ${version} (${shortPath})`,
				value: p,
			});
		} catch {
			list.push({
				name: p,
				value: p,
			});
		}
	}

	return list;
}

export const moduleMap: Record<string, string> = {
	// 视觉/图像
	cv2: 'opencv-python',
	PIL: 'Pillow',

	// 机器学习/AI
	sklearn: 'scikit-learn',

	// 网络/爬虫
	bs4: 'beautifulsoup4',

	// 数据库/ORM
	MySQLdb: 'mysqlclient',
	psycopg2: 'psycopg2-binary',
	sqlalchemy: 'SQLAlchemy',

	// Web框架
	fastapi: 'fastapi uvicorn[standard]',

	// 可视化
	matplotlib: 'matplotlib',
	plt: 'matplotlib',

	// 配置/序列化
	yaml: 'PyYAML',

	// 日期时间
	dateutil: 'python-dateutil',

	// 文件格式
	pandas_gbq: 'pandas-gbq',

	// 文档/文本
	md: 'markdown',

	// 加密/安全
	jwt: 'PyJWT',
	pyjwt: 'PyJWT',

	// 网络协议
	grpc: 'grpcio',
	websockets: 'websockets',
	socketio: 'python-socketio',
	mqtt: 'paho-mqtt',
	websocket: 'websocket-client',

	// 消息应用API
	telegram: 'python-telegram-bot',
	telebot: 'pyTelegramBotAPI',
	discord: 'discord.py',
	vk_api: 'vk-api',

	// 图形/二维码
	qrcode: 'qrcode[pil]',

	// 科学/地理
	nx: 'networkx',
	igraph: 'python-igraph',

	skimage: 'scikit-image',
	enum: 'enum34',
};
