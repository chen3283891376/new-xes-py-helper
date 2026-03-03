import { spawn, type Subprocess } from 'bun';
import { platform } from 'os';
import path from 'path';
import type { Writable } from 'stream';

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
	const args = isWin ? ['python'] : ['python3'];

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

const moduleMap: Record<string, string> = {
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

export class PythonProcessManager {
	private pythonProcess: Subprocess | null = null;
	private pythonPath: string = 'python';
	private processReady = false;
	private pendingInputs: string[] = [];

	// callbacks for streaming output
	private stdoutCallback: ((chunk: string) => void) | null = null;
	private stderrCallback: ((chunk: string) => void) | null = null;
	private exitCallback: ((code: number) => void) | null = null;

	constructor(pythonPath: string) {
		this.pythonPath = pythonPath;
	}

	onStdout(cb: (chunk: string) => void) {
		this.stdoutCallback = cb;
	}

	onStderr(cb: (chunk: string) => void) {
		this.stderrCallback = cb;
	}

	onExit(cb: (code: number) => void) {
		this.exitCallback = cb;
	}

	async startProcess(filePath: string, workDir: string): Promise<void> {
		this.pythonProcess = spawn({
			cmd: [this.pythonPath, '-u', path.basename(filePath)],
			cwd: workDir,
			stdout: 'pipe',
			stderr: 'pipe',
			stdin: 'pipe',
			env: {
				...process.env,
				PYTHONIOENCODING: 'utf-8',
				PYTHONUTF8: '1',
			},
		});

		this.processReady = true;

		const decoder = new TextDecoder();
		const readStream = async (
			reader: ReadableStreamDefaultReader<Uint8Array>,
			cb: ((chunk: string) => void) | null,
		) => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const text = decoder.decode(value, { stream: true });
					if (cb) cb(text);
				}
			} catch (_err) {
				// ignore - process may have closed the stream
			}
		};

		if (this.pythonProcess.stdout) {
			readStream(
				// @ts-ignore
				this.pythonProcess.stdout.getReader(),
				this.stdoutCallback,
			);
		}
		if (this.pythonProcess.stderr) {
			readStream(
				// @ts-ignore
				this.pythonProcess.stderr.getReader(),
				this.stderrCallback,
			);
		}

		while (this.pendingInputs.length > 0) {
			const input = this.pendingInputs.shift()!;
			this.sendInput(input);
		}

		this.pythonProcess.exited
			.then((code) => {
				this.processReady = false;
				this.pythonProcess = null;
				if (this.exitCallback) {
					try {
						this.exitCallback(code);
					} catch (_e) {
						// ignore
					}
				}
			})
			.catch(() => {
				// ignore
			});
	}

	sendInput(data: string): void {
		if (this.pythonProcess && this.pythonProcess.stdin) {
			(this.pythonProcess.stdin as unknown as Writable).write(
				new TextEncoder().encode(data),
			);
		} else if (!this.processReady) {
			this.pendingInputs.push(data);
		}
	}

	// 读取进程输出（一次性获取）。
	// 注意：如果你已经通过 `onStdout`/`onStderr` 注册了回调，此方法
	// 可能不会返回任何数据，因为流已经被消费。建议使用回调
	// 或者只在不需要实时流式传输的场景下调用它。
	async readOutput(): Promise<{ stdout: string; stderr: string }> {
		if (!this.pythonProcess) {
			throw new Error('进程未启动');
		}
		if (this.stdoutCallback || this.stderrCallback) {
			throw new Error('无法在启用流回调的情况下读取完整输出');
		}

		// @ts-ignore
		const stdoutReader = this.pythonProcess.stdout?.getReader();
		// @ts-ignore
		const stderrReader = this.pythonProcess.stderr?.getReader();
		const decoder = new TextDecoder();

		let stdout = '';
		let stderr = '';

		const readStream = async (
			reader: ReadableStreamDefaultReader<Uint8Array>,
			target: string,
		) => {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				target += decoder.decode(value, { stream: true });
			}
			return target;
		};

		const [newStdout, newStderr] = await Promise.all([
			readStream(stdoutReader, stdout),
			readStream(stderrReader, stderr),
		]);

		return { stdout: newStdout, stderr: newStderr };
	}

	async waitForExit(): Promise<number> {
		if (!this.pythonProcess) {
			throw new Error('进程未启动');
		}
		return await this.pythonProcess.exited;
	}

	killProcess(): void {
		if (this.pythonProcess) {
			this.pythonProcess.kill();
			this.pythonProcess = null;
			this.processReady = false;
		}
	}

	async installPackage(
		packageName: string,
	): Promise<{ exitCode: number; output: string }> {
		const proc = spawn({
			cmd: [
				this.pythonPath,
				'-m',
				'pip',
				'install',
				moduleMap[packageName] || packageName,
				'--no-cache-dir',
				'--no-warn-script-location',
				'--only-binary',
				':all:',
			],
			stdout: 'pipe',
			stderr: 'pipe',
		});

		const stdoutReader = proc.stdout.getReader();
		const stderrReader = proc.stderr.getReader();
		const decoder = new TextDecoder();
		let fullOutput = '';

		const readAll = async (
			reader: ReadableStreamDefaultReader<Uint8Array>,
		) => {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				fullOutput += decoder.decode(value, { stream: true });
			}
		};

		await Promise.all([
			// @ts-ignore
			readAll(stdoutReader),
			// @ts-ignore
			readAll(stderrReader),
		]);

		const exitCode = await proc.exited;
		return { exitCode, output: fullOutput };
	}

	isRunning(): boolean {
		return this.pythonProcess !== null && !this.pythonProcess.killed;
	}

	getProcessId(): number | null {
		return this.pythonProcess?.pid || null;
	}

	clearPendingInputs(): void {
		this.pendingInputs = [];
	}

	setPythonPath(path: string): void {
		this.pythonPath = path;
	}
}
