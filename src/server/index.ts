import { listenAddress, startCardServer } from "./attach.js";

const port = Number(process.env.PORT) || 2567;
const server = await startCardServer(port);
const actual = listenAddress(server).port;
console.log(`牌桌已启动：http://127.0.0.1:${actual}`);
console.log("朋友联机时打开同一个网址。外网隧道转发这个端口即可。");
