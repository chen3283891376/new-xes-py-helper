import { select } from '@inquirer/prompts';
import { checkPorts, getPort } from './src/utils';
import { getLocalPythonInterpreters, PythonProcessManager } from './src/python';
import { createWsServer, HttpRouteHandler } from './src/servers';
import nanolog from '@turbowarp/nanolog';
import { spawn } from 'bun';
import { existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';

(async () => {
	const logger = nanolog('Main');

	const pythonInterpreters = await getLocalPythonInterpreters();
	if (pythonInterpreters.length === 0) {
		logger.error('未找到可用的Python环境');
		process.exit(1);
	}

	// 平台检测：Linux 使用项目内 venv（如果不存在则创建），Windows 使用系统 Python
	let currentPython: string;
	let projectVenv: string | undefined = undefined;
	const isWin = platform() === 'win32';

	if (isWin) {
		currentPython = await select({
			message: '请选择Python环境',
			choices: pythonInterpreters,
		});
		logger.info('Windows 平台，使用系统 Python:', currentPython);
	} else {
		// Linux / macOS: 在项目根创建 .venv（首次运行创建），并使用其中的 python
		projectVenv = join(process.cwd(), '.venv');

		// 选择用于创建 venv 的系统 Python（优先 python3）
		// const sysCandidate = pythonInterpreters.find(p => /python3?$/i.test(p.value))?.value || 'python3';
		const sysCandidate = await select({
			message: '请选择用于创建 venv 的系统 Python',
			choices: pythonInterpreters,
		});

		if (!existsSync(projectVenv)) {
			logger.info('未检测到 .venv，正在创建 venv：', projectVenv);
			try {
				const createProc = spawn(
					[sysCandidate, '-m', 'venv', projectVenv],
					{
						stdout: 'inherit',
						stderr: 'inherit',
					},
				);
				await createProc.exited;
				logger.info('.venv 创建完成');
			} catch (err) {
				logger.error('创建 venv 失败：', err);
				process.exit(1);
			}
		} else {
			logger.info('.venv 已存在：', projectVenv);
		}

		// 使用 venv 中的 python
		currentPython = sysCandidate; // 仍以系统 python 为基础，ProcessManager 会通过 venvPath 调整环境
		logger.info('Linux 平台，使用 venv 中的 Python');
	}

	// 检查端口是否可用
	let port: number = 55820;

	if (await checkPorts()) {
		port = getPort();
		logger.info('端口检查通过');
		logger.info('HTTP 端口：', port);
		logger.info('Websocket 端口：', port + 1);
	} else {
		logger.error('端口检查失败');
		process.exit(1);
	}

	// 开启HTTP服务
	Bun.serve({
		port: port,
		hostname: '127.0.0.1',
		routes: HttpRouteHandler.getRoutes(),
	});

	const pythonProcess = new PythonProcessManager(currentPython, projectVenv);

	// 开启Websocket服务
	createWsServer(port + 1, pythonProcess);
})();
