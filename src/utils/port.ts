import net from 'net';
import nanolog from '@turbowarp/nanolog'

let port = 55820;
const port_list = [55820, 55825, 55830, 55835];
const logger = nanolog('Port')

function checkPortByBind(port: number) {
	return new Promise((resolve) => {
		const server = net.createServer();

		server.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'EADDRINUSE') {
				resolve(false);
			} else {
				resolve(false);
			}
		});

		server.on('listening', () => {
			server.close();
			resolve(true);
		});

		server.listen(port, '127.0.0.1');

		setTimeout(() => {
			if (!server.listening) {
				server.close();
				resolve(false);
			}
		}, 100);
	});
}
function checkPort(port: number, ip: string = '127.0.0.1') {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		socket.setTimeout(100);
		socket.on('connect', () => {
			socket.destroy();
			// 有响应，说明端口被占用
			resolve(false);
		});
		socket.on('timeout', () => {
			socket.destroy();
			// 没有响应，再用bind方法试试
			resolve(checkPortByBind(port));
		});
		socket.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'ECONNREFUSED') {
				// 进一步用绑定方式确认
				resolve(checkPortByBind(port));
			} else {
				resolve(false);
			}
			socket.destroy();
		});

		socket.connect(port, ip);
	});
}
function isNumber(str: string): boolean {
	return !isNaN(parseInt(str)) && isFinite(parseInt(str));
}

export async function checkPorts(): Promise<boolean> {
	const args = process.argv.slice(2);

	for (const arg of args) {
		if (isNumber(arg)) {
			port = parseInt(arg);
			let allAvailable = true;
			for (let i = 0; i < 4; i++) {
				if (!(await checkPort(port + i))) {
					allAvailable = false;
					break;
				}
			}

			if (allAvailable) {
				logger.info(`使用命令行指定的端口: ${port}-${port + 3}`);
				return true;
			}
		}
	}

	for (const p of port_list) {
		let portAvailable = true;

		for (let i = 0; i < 4; i++) {
			if (!(await checkPort(p + i))) {
				portAvailable = false;
				break;
			}
		}

		if (portAvailable) {
			port = p;
			logger.info(`使用预设端口列表中的端口: ${p}-${p + 3}`)
			return true;
		}
	}

	logger.log('未找到可用的端口组(连续4个端口)')
	return false;
}

export function getPort() {
	return port;
}
