import { spawn, type Subprocess } from 'bun';
import path from 'path';
import { kill } from 'process';
import type { Writable } from 'stream';
import { moduleMap } from './utils';

export class PythonProcessManager {
	private pythonProcess: Subprocess | null = null;
	public pythonPath: string = 'python';
	private processReady = false;
	private pendingInputs: string[] = [];
	private venvPath: string | null = null;

	private stdoutCallbacks: Set<(chunk: string) => void> = new Set();
	private stderrCallbacks: Set<(chunk: string) => void> = new Set();
	private exitCallbacks: Set<(code: number) => void> = new Set();

	constructor(pythonPath: string, venvPath?: string) {
		this.pythonPath = pythonPath;
		if (venvPath) {
			this.venvPath = venvPath;
		}
	}

	// 设置/更新 venv 路径
	setVenvPath(venvPath: string): void {
		this.venvPath = venvPath;
		this.updatePythonPath();
	}

	// 更新 Python 路径
	private updatePythonPath(): void {
		if (this.venvPath) {
			if (process.platform === 'win32') {
				this.pythonPath = path.join(
					this.venvPath,
					'Scripts',
					'python.exe',
				);
			} else {
				this.pythonPath = path.join(this.venvPath, 'bin', 'python');
			}
		}
	}

	// 注册回调
	onStdout(cb: (chunk: string) => void) {
		this.stdoutCallbacks.add(cb);
	}

	offStdout(cb: (chunk: string) => void) {
		this.stdoutCallbacks.delete(cb);
	}

	onStderr(cb: (chunk: string) => void) {
		this.stderrCallbacks.add(cb);
	}

	offStderr(cb: (chunk: string) => void) {
		this.stderrCallbacks.delete(cb);
	}

	onExit(cb: (code: number) => void) {
		this.exitCallbacks.add(cb);
	}

	offExit(cb: (code: number) => void) {
		this.exitCallbacks.delete(cb);
	}

	// 触发回调
	private emitStdout(chunk: string) {
		this.stdoutCallbacks.forEach((cb) => {
			try {
				cb(chunk);
			} catch {
				// 忽略回调错误
			}
		});
	}

	private emitStderr(chunk: string) {
		this.stderrCallbacks.forEach((cb) => {
			try {
				cb(chunk);
			} catch {
				// 忽略回调错误
			}
		});
	}

	private emitExit(code: number) {
		this.exitCallbacks.forEach((cb) => {
			try {
				cb(code);
			} catch {
				// 忽略回调错误
			}
		});
	}

	async startProcess(filePath: string, workDir: string): Promise<void> {
		// 如果设置了 venv 路径，更新 Python 路径
		if (this.venvPath) {
			this.updatePythonPath();
		}

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
				// 设置 venv 激活环境变量
				...(this.venvPath && {
					VIRTUAL_ENV: this.venvPath,
					PATH:
						process.platform === 'win32'
							? `${path.join(this.venvPath, 'Scripts')};${process.env.PATH}`
							: `${path.join(this.venvPath, 'bin')}:${process.env.PATH}`,
				}),
			},
		});

		this.processReady = true;

		// 设置输出流读取
		await this.setupProcessStreams(this.pythonProcess);

		// 处理积压的输入
		while (this.pendingInputs.length > 0) {
			const input = this.pendingInputs.shift()!;
			this.sendInput(input);
		}

		// 监听进程退出
		this.pythonProcess.exited
			.then((code) => {
				this.processReady = false;
				this.pythonProcess = null;
				this.emitExit(code);
			})
			.catch(() => {
				// 忽略退出错误
			});
	}

	// 通用流读取方法
	private async setupProcessStreams(proc: Subprocess) {
		const decoder = new TextDecoder();

		const readStream = async (
			reader: ReadableStreamDefaultReader<Uint8Array>,
			isStdout: boolean,
		) => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const text = decoder.decode(value, { stream: true });
					if (isStdout) {
						this.emitStdout(text);
					} else {
						this.emitStderr(text);
					}
				}
			} catch {
				// 流已关闭或进程终止
			}
		};

		if (proc.stdout) {
			// @ts-expect-error - getReader 类型问题
			readStream(proc.stdout.getReader(), true);
		}

		if (proc.stderr) {
			// @ts-expect-error - getReader 类型问题
			readStream(proc.stderr.getReader(), false);
		}
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

	sendCtrlC(): void {
		if (this.pythonProcess && this.pythonProcess.stdin) {
			kill(this.pythonProcess.pid, 'SIGINT');
		}
	}

	// 读取进程输出（一次性获取）
	async readOutput(): Promise<{ stdout: string; stderr: string }> {
		if (!this.pythonProcess) {
			throw new Error('进程未启动');
		}
		if (this.stdoutCallbacks.size > 0 || this.stderrCallbacks.size > 0) {
			throw new Error('无法在启用流回调的情况下读取完整输出');
		}

		// @ts-expect-error - getReader 类型问题
		const stdoutReader = this.pythonProcess.stdout?.getReader();
		// @ts-expect-error - getReader 类型问题
		const stderrReader = this.pythonProcess.stderr?.getReader();
		const decoder = new TextDecoder();

		const readStream = async (
			reader: ReadableStreamDefaultReader<Uint8Array>,
		) => {
			let target = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				target += decoder.decode(value, { stream: true });
			}
			return target;
		};

		const [newStdout, newStderr] = await Promise.all([
			stdoutReader ? readStream(stdoutReader) : Promise.resolve(''),
			stderrReader ? readStream(stderrReader) : Promise.resolve(''),
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

	// 安装包到 venv
	installPackage(
		packageName: string,
		upgrade: boolean = false,
	): Promise<{ exitCode: number; output: string }> {
		return new Promise((resolve) => {
			let fullOutput = '';

			const collectOutput = (chunk: string) => {
				fullOutput += chunk;
			};

			this.onStdout(collectOutput);
			this.onStderr(collectOutput);

			try {
				const cmd = [
					this.pythonPath,
					'-m',
					'pip',
					'install',
					moduleMap[packageName] || packageName,
					'--no-cache-dir',
					'--no-warn-script-location',
					'--only-binary',
					':all:',
				];

				if (upgrade) {
					cmd.splice(3, 0, '--upgrade');
				}

				const proc = spawn({
					cmd,
					stdout: 'pipe',
					stderr: 'pipe',
					env: {
						...process.env,
						...(this.venvPath && {
							VIRTUAL_ENV: this.venvPath,
							PATH:
								process.platform === 'win32'
									? `${path.join(this.venvPath, 'Scripts')};${process.env.PATH}`
									: `${path.join(this.venvPath, 'bin')}:${process.env.PATH}`,
						}),
					},
				});

				this.readInstallationOutput(proc).then(async () => {
					const exitCode = await proc.exited;
					this.offStdout(collectOutput);
					this.offStderr(collectOutput);
					resolve({ exitCode, output: fullOutput });
				});
			} finally {
				this.offStdout(collectOutput);
				this.offStderr(collectOutput);
			}
		});
	}

	// 检查是否在 venv 中运行
	isInVenv(): boolean {
		return this.venvPath !== null;
	}

	// 获取 venv 路径
	getVenvPath(): string | null {
		return this.venvPath;
	}

	private async readInstallationOutput(proc: Subprocess) {
		const decoder = new TextDecoder();

		const readStream = async (
			reader: ReadableStreamDefaultReader<Uint8Array>,
			isStdout: boolean,
		) => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const text = decoder.decode(value, { stream: true });
					if (isStdout) {
						this.emitStdout(text);
					} else {
						this.emitStderr(text);
					}
				}
			} catch {
				// 流读取完成
			}
		};

		await Promise.all([
			proc.stdout
			// @ts-expect-error - 类型问题
				? readStream(proc.stdout.getReader(), true)
				: Promise.resolve(),
			proc.stderr
			// @ts-expect-error - 类型问题
				? readStream(proc.stderr.getReader(), false)
				: Promise.resolve(),
		]);
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

	getCallbackCounts() {
		return {
			stdout: this.stdoutCallbacks.size,
			stderr: this.stderrCallbacks.size,
			exit: this.exitCallbacks.size,
		};
	}
}
