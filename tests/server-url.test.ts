import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveServerUrl } from "../src/server/public-url.js";

describe("牌局地址", () => {
  it("开发页指向同一台机器的房间端口", () => {
    assert.equal(
      resolveServerUrl({
        protocol: "http:",
        hostname: "192.168.1.8",
        port: "5173",
        origin: "http://192.168.1.8:5173",
      }),
      "http://192.168.1.8:2567",
    );
  });

  it("打包页面和隧道跟着当前网址", () => {
    assert.equal(
      resolveServerUrl({
        protocol: "https:",
        hostname: "demo.example",
        port: "",
        origin: "https://demo.example",
      }),
      "https://demo.example",
    );
  });

  it("显式配置优先，并去掉末尾斜杠", () => {
    assert.equal(
      resolveServerUrl({
        configured: "https://play.example/",
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "5173",
        origin: "http://127.0.0.1:5173",
      }),
      "https://play.example",
    );
  });
});