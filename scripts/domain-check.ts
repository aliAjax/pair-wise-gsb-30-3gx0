/* 领域闭环校验：创建→占用→改时段→装油锁定→发车→到站回写→释放→持久化对应 */
import "./shim";
import {
  state,
  activeOccupancies,
  activeOccupancyOfOrder,
  receiptOfOrder,
  revisionsOfOrder,
  resetState,
  STORAGE_KEY
} from "../src/domain/store";
import { cancelOrder, changeSlot, confirmArrival, createOrder, departOrder, loadOrder } from "../src/domain/ops";
import { addDays, todayStr } from "../src/domain/time";
import type { State } from "../src/domain/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, extra ?? ""); }
}
const slotId = (offset: number, key: string) => `slot-${addDays(todayStr(), offset)}-${key}`;

console.log("== 1. 种子数据与占用对应 ==");
check("3 张种子单", state.orders.length === 3);
check("活跃占用 2 条（待装油+运输中）", activeOccupancies().length === 2);
check("已到站订单占用已释放", !activeOccupancyOfOrder("o3"));
check("o3 有回单且含原计划值", receiptOfOrder("o3")?.lines[0].plannedTons === 20);
check("o3 修订链 4 环", revisionsOfOrder("o3").length === 4);

console.log("== 2. 创建拦截：重叠/证件/年检/隔仓 ==");
let r = createOrder({ station: "机场站", tankerId: "t1", driverId: "d4", slotId: slotId(1, "a"), lines: [{ fuel: "柴油", plannedTons: 10 }], notes: "" });
check("车辆时段重叠被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("车辆时段重叠")), r.ok ? "" : r.blocked.triggers);
if (!r.ok) {
  check("拦截记录含车牌/人员/时段/油品",
    r.blocked.plate === "鲁A·D2316" && r.blocked.driverName === "刘铁柱" && r.blocked.slotLabel.includes("06:00") && r.blocked.fuels === "柴油");
}
r = createOrder({ station: "机场站", tankerId: "t4", driverId: "d1", slotId: slotId(1, "a"), lines: [{ fuel: "柴油", plannedTons: 10 }], notes: "" });
check("人员时段重叠被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("人员时段重叠")));
r = createOrder({ station: "机场站", tankerId: "t4", driverId: "d3", slotId: slotId(1, "c"), lines: [{ fuel: "柴油", plannedTons: 10 }], notes: "" });
check("证件失效被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("证件失效")));
r = createOrder({ station: "机场站", tankerId: "t3", driverId: "d4", slotId: slotId(1, "c"), lines: [{ fuel: "柴油", plannedTons: 10 }], notes: "" });
check("年检过期被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("年检过期")));
r = createOrder({ station: "机场站", tankerId: "t2", driverId: "d4", slotId: slotId(1, "c"), lines: [{ fuel: "柴油", plannedTons: 10 }, { fuel: "95号汽油", plannedTons: 5 }], notes: "" });
check("单仓混装两种油品被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("无隔仓")));
r = createOrder({ station: "机场站", tankerId: "t4", driverId: "d4", slotId: slotId(1, "c"), lines: [{ fuel: "柴油", plannedTons: 30 }], notes: "" });
check("超载被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("核定载重")));
check("拦截事件已累积", state.blocked.length >= 6, state.blocked.length);

console.log("== 3. 改时段：先释放原占用 ==");
const before = activeOccupancyOfOrder("o1")!;
r = changeSlot("o1", slotId(1, "c")); // a(06-10) → c(14-18)，无交集，真正释放 a
check("改时段成功", r.ok);
check("原占用已释放且注明原因", before.state === "released" && before.releaseReason === "改时段释放");
check("新占用指向新时段", activeOccupancyOfOrder("o1")?.slotId === slotId(1, "c"));
check("修订链记录释放与改占用", revisionsOfOrder("o1").some((v) => v.summary.includes("释放原占用")));
// 原时段已空出，可被他人占用
r = createOrder({ station: "新区站", tankerId: "t1", driverId: "d1", slotId: slotId(1, "a"), lines: [{ fuel: "92号汽油", plannedTons: 20 }], notes: "" });
check("原时段释放后可再占用", r.ok, r.ok ? "" : r.blocked.triggers);
const newOrderId = state.orders[0].id;
// 再改回被占用的时段 → 拦截且保留现占用
r = changeSlot("o1", slotId(1, "a"));
check("改到已占用时段被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("时段重叠")), r.ok ? "" : r.blocked.triggers);
check("被挡后仍占用现时段", activeOccupancyOfOrder("o1")?.slotId === slotId(1, "c"));

console.log("== 4. 装油锁定与发车 ==");
r = departOrder("o1");
check("未装油不得发车", !r.ok && r.blocked.triggers.some((t) => t.includes("须先装油")));
r = loadOrder("o1");
const o1 = state.orders.find((o) => o.id === "o1")!;
check("装油后锁定", r.ok && o1.locked && o1.status === "已装油");
r = changeSlot("o1", slotId(2, "a"));
check("锁定后改时段被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("已装油锁定")));
r = cancelOrder("o1");
check("锁定后取消被挡", !r.ok);
// 模拟发车当日证件失效
const d1 = state.drivers.find((d) => d.id === "d1")!;
const keep = d1.licenseUntil;
d1.licenseUntil = addDays(todayStr(), -1);
r = departOrder("o1");
check("发车时证件失效被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("证件失效")));
d1.licenseUntil = keep;
r = departOrder("o1");
check("证件恢复后可发车", r.ok && o1.status === "运输中");

console.log("== 5. 到站确认与差异回写 ==");
r = confirmArrival("o1", [{ fuel: "92号汽油", actualTons: 17, reason: "" }, { fuel: "95号汽油", actualTons: 10, reason: "" }]);
check("差异超2%无原因被挡", !r.ok && r.blocked.triggers.some((t) => t.includes("须记录原因")));
check("被挡时占用未释放", !!activeOccupancyOfOrder("o1"));
r = confirmArrival("o1", [{ fuel: "92号汽油", actualTons: 17, reason: "卸油管线残留" }, { fuel: "95号汽油", actualTons: 10.1, reason: "" }]);
check("记录原因后确认成功", r.ok && o1.status === "已到站");
const rc = receiptOfOrder("o1")!;
check("回单回写实卸量", rc.lines[0].actualTons === 17 && rc.lines[1].actualTons === 10.1);
check("回单保留原计划值", rc.lines[0].plannedTons === 18);
check("差异百分比正确", rc.lines[0].diffPct === -5.6, rc.lines[0].diffPct);
check("到站后占用释放", !activeOccupancyOfOrder("o1") && state.occupancies.filter((o) => o.orderId === "o1").every((o) => o.state === "released"));
check("修订链含回单号与差异", revisionsOfOrder("o1").some((v) => v.type === "到站确认" && v.summary.includes(rc.code)));

console.log("== 6. 取消与重载对应 ==");
r = cancelOrder(newOrderId);
check("待装油订单可取消", r.ok && !state.orders.some((o) => o.id === newOrderId));
check("取消后占用与修订链级联清理", !state.occupancies.some((o) => o.orderId === newOrderId) && !state.revisions.some((v) => v.orderId === newOrderId));

// 真实重载模拟：从 localStorage 读回快照校验对应关系
const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as State;
const orderIds = new Set(snapshot.orders.map((o) => o.id));
check("重载后占用均对应订单", snapshot.occupancies.every((o) => orderIds.has(o.orderId)));
check("重载后回单均对应订单", snapshot.receipts.every((x) => orderIds.has(x.orderId)));
check("重载后修订链均对应订单", snapshot.revisions.every((v) => orderIds.has(v.orderId)));
check("重载后已到站订单有回单", snapshot.orders.filter((o) => o.status === "已到站").every((o) => snapshot.receipts.some((x) => x.orderId === o.id)));
check("重载后未完结订单有活跃占用", snapshot.orders.filter((o) => o.status !== "已到站").every((o) => snapshot.occupancies.some((x) => x.orderId === o.id && x.state === "active")));
check("重载后拦截记录仍在", snapshot.blocked.length > 0);

resetState();
check("重置后回到 3 张种子单", state.orders.length === 3);

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
