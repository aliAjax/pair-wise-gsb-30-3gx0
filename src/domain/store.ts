import { reactive } from "vue";
import type {
  DeliveryOrder,
  Driver,
  Occupancy,
  Receipt,
  Revision,
  Slot,
  State,
  Tanker
} from "./types";
import { addDays, isoDaysAgo, nowIso, todayStr } from "./time";

export const STORAGE_KEY = "hxwlfront-19-oil-delivery-v2";
export const STATE_VERSION = 2;

const pad = (n: number) => String(n).padStart(2, "0");

export function slotLabel(slot: Slot | undefined): string {
  if (!slot) return "未知时段";
  return `${slot.date.slice(5)} ${slot.start}-${slot.end}`;
}

function buildSlots(): Slot[] {
  const spans = [
    { key: "a", start: "06:00", end: "10:00" },
    { key: "b", start: "09:30", end: "13:30" },
    { key: "c", start: "14:00", end: "18:00" }
  ];
  const slots: Slot[] = [];
  // 昨天起的时段：昨天用于已完成的种子单，今天及之后可选
  for (const offset of [-1, 0, 1, 2]) {
    const date = addDays(todayStr(), offset);
    for (const span of spans) {
      slots.push({ id: `slot-${date}-${span.key}`, date, start: span.start, end: span.end });
    }
  }
  return slots;
}

function seedState(): State {
  const today = todayStr();
  const slots = buildSlots();
  const slot = (date: string, key: string) => slots.find((s) => s.id === `slot-${date}-${key}`)!;
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);

  const tankers: Tanker[] = [
    { id: "t1", plate: "鲁A·D2316", capacityTons: 32, compartments: 2, inspectionUntil: addDays(today, 190) },
    { id: "t2", plate: "鲁A·D8820", capacityTons: 28, compartments: 1, inspectionUntil: addDays(today, 100) },
    // 年检已过期，用于演示拦截
    { id: "t3", plate: "鲁B·T5092", capacityTons: 30, compartments: 3, inspectionUntil: addDays(today, -20) },
    { id: "t4", plate: "鲁A·G7758", capacityTons: 25, compartments: 2, inspectionUntil: addDays(today, 280) }
  ];

  const drivers: Driver[] = [
    { id: "d1", name: "王建国", licenseNo: "YS3701001", licenseUntil: addDays(today, 250) },
    { id: "d2", name: "李长顺", licenseNo: "YS3701002", licenseUntil: addDays(today, 11) },
    // 证件已失效，用于演示拦截
    { id: "d3", name: "赵德柱", licenseNo: "YS3701003", licenseUntil: addDays(today, -19) },
    { id: "d4", name: "刘铁柱", licenseNo: "YS3701004", licenseUntil: addDays(today, 500) }
  ];

  const orders: DeliveryOrder[] = [
    {
      id: "o1",
      code: `PS${today.replace(/-/g, "")}-001`,
      station: "城东站",
      tankerId: "t1",
      driverId: "d1",
      slotId: slot(tomorrow, "a").id,
      status: "待装油",
      lines: [
        { fuel: "92号汽油", plannedTons: 18 },
        { fuel: "95号汽油", plannedTons: 10 }
      ],
      notes: "双仓分装，92/95 分仓",
      locked: false,
      createdAt: isoDaysAgo(0, 8, 20)
    },
    {
      id: "o2",
      code: `PS${today.replace(/-/g, "")}-002`,
      station: "机场站",
      tankerId: "t2",
      driverId: "d2",
      slotId: slot(today, "a").id,
      status: "运输中",
      lines: [{ fuel: "柴油", plannedTons: 12 }],
      notes: "车辆已出库",
      locked: true,
      createdAt: isoDaysAgo(0, 6, 5),
      loadedAt: isoDaysAgo(0, 7, 30),
      departedAt: isoDaysAgo(0, 8, 10)
    },
    {
      id: "o3",
      code: `PS${yesterday.replace(/-/g, "")}-003`,
      station: "新区站",
      tankerId: "t4",
      driverId: "d4",
      slotId: slot(yesterday, "b").id,
      status: "已到站",
      lines: [{ fuel: "95号汽油", plannedTons: 20 }],
      notes: "已送达并完成回单",
      locked: true,
      createdAt: isoDaysAgo(1, 8, 0),
      loadedAt: isoDaysAgo(1, 9, 40),
      departedAt: isoDaysAgo(1, 10, 5),
      arrivedAt: isoDaysAgo(1, 13, 20)
    }
  ];

  const occupancies: Occupancy[] = [
    {
      id: "occ1",
      orderId: "o1",
      tankerId: "t1",
      driverId: "d1",
      slotId: orders[0].slotId,
      state: "active",
      createdAt: orders[0].createdAt
    },
    {
      id: "occ2",
      orderId: "o2",
      tankerId: "t2",
      driverId: "d2",
      slotId: orders[1].slotId,
      state: "active",
      createdAt: orders[1].createdAt
    },
    {
      id: "occ3",
      orderId: "o3",
      tankerId: "t4",
      driverId: "d4",
      slotId: orders[2].slotId,
      state: "released",
      createdAt: orders[2].createdAt,
      releasedAt: orders[2].arrivedAt,
      releaseReason: "到站确认释放"
    }
  ];

  const receipts: Receipt[] = [
    {
      id: "r1",
      orderId: "o3",
      code: `HD${yesterday.replace(/-/g, "")}-001`,
      confirmedAt: orders[2].arrivedAt!,
      lines: [
        {
          fuel: "95号汽油",
          plannedTons: 20,
          actualTons: 19.4,
          diffPct: -3,
          reason: "途中损耗及罐底残留，已复磅确认"
        }
      ]
    }
  ];

  const revisions: Revision[] = [
    { id: "rev1", orderId: "o1", at: orders[0].createdAt, type: "创建", summary: "创建配送单：鲁A·D2316 / 王建国 / 92号汽油 18吨 + 95号汽油 10吨" },
    { id: "rev2", orderId: "o2", at: orders[1].createdAt, type: "创建", summary: "创建配送单：鲁A·D8820 / 李长顺 / 柴油 12吨" },
    { id: "rev3", orderId: "o2", at: orders[1].loadedAt!, type: "装油", summary: "装油完成，锁定车牌、司机、油品、吨数" },
    { id: "rev4", orderId: "o2", at: orders[1].departedAt!, type: "发车", summary: "发车前往 机场站" },
    { id: "rev5", orderId: "o3", at: orders[2].createdAt, type: "创建", summary: "创建配送单：鲁A·G7758 / 刘铁柱 / 95号汽油 20吨" },
    { id: "rev6", orderId: "o3", at: orders[2].loadedAt!, type: "装油", summary: "装油完成，锁定车牌、司机、油品、吨数" },
    { id: "rev7", orderId: "o3", at: orders[2].departedAt!, type: "发车", summary: "发车前往 新区站" },
    {
      id: "rev8",
      orderId: "o3",
      at: orders[2].arrivedAt!,
      type: "到站确认",
      summary: `到站确认，回单 ${receipts[0].code}：95号汽油 计划20吨 实卸19.4吨（-3.0%，超2%已记录原因）`
    }
  ];

  return {
    version: STATE_VERSION,
    seq: 3,
    tankers,
    drivers,
    slots,
    orders,
    occupancies,
    receipts,
    revisions,
    blocked: []
  };
}

/** 重载后校验订单、占用、回单、修订链的对应关系，剔除孤儿并补齐缺失占用 */
function repairIntegrity(state: State): string[] {
  const warnings: string[] = [];
  const orderIds = new Set(state.orders.map((o) => o.id));
  const slotIds = new Set(state.slots.map((s) => s.id));

  const before = state.occupancies.length + state.receipts.length + state.revisions.length;
  state.occupancies = state.occupancies.filter((o) => orderIds.has(o.orderId) && slotIds.has(o.slotId));
  state.receipts = state.receipts.filter((r) => orderIds.has(r.orderId));
  state.revisions = state.revisions.filter((r) => orderIds.has(r.orderId));
  const dropped = before - (state.occupancies.length + state.receipts.length + state.revisions.length);
  if (dropped > 0) warnings.push(`清理 ${dropped} 条孤儿记录`);

  for (const order of state.orders) {
    const active = state.occupancies.filter((o) => o.orderId === order.id && o.state === "active");
    if (order.status === "已到站") {
      // 已到站不应再有活跃占用
      for (const occ of active) {
        occ.state = "released";
        occ.releasedAt = occ.releasedAt ?? order.arrivedAt ?? nowIso();
        occ.releaseReason = occ.releaseReason ?? "到站确认释放";
        warnings.push(`订单 ${order.code} 到站后仍有占用，已补释放`);
      }
      continue;
    }
    if (active.length === 0) {
      state.occupancies.push({
        id: `occ-fix-${order.id}`,
        orderId: order.id,
        tankerId: order.tankerId,
        driverId: order.driverId,
        slotId: order.slotId,
        state: "active",
        createdAt: order.createdAt
      });
      warnings.push(`订单 ${order.code} 缺少占用记录，已补齐`);
    } else if (active.length > 1) {
      // 同一订单只保留一条活跃占用
      for (const extra of active.slice(1)) {
        extra.state = "released";
        extra.releasedAt = nowIso();
        extra.releaseReason = "完整性修复";
      }
      warnings.push(`订单 ${order.code} 存在多条活跃占用，已去重`);
    }
  }
  return warnings;
}

function loadState(): State {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as State;
      if (parsed && parsed.version === STATE_VERSION && Array.isArray(parsed.orders)) {
        const warnings = repairIntegrity(parsed);
        if (warnings.length) console.warn("[dispatch] 完整性修复:", warnings);
        return parsed;
      }
      console.warn("[dispatch] 本地数据版本不符，重新初始化");
    } catch {
      console.warn("[dispatch] 本地数据解析失败，重新初始化");
    }
  }
  return seedState();
}

export const state = reactive<State>(loadState());

export function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("[dispatch] 持久化失败", err);
  }
}

export function resetState(): void {
  const fresh = seedState();
  Object.assign(state, fresh);
  persist();
}

/* ---------- 查询辅助 ---------- */

export const tankerById = (id: string) => state.tankers.find((t) => t.id === id);
export const driverById = (id: string) => state.drivers.find((d) => d.id === id);
export const slotById = (id: string) => state.slots.find((s) => s.id === id);
export const orderById = (id: string) => state.orders.find((o) => o.id === id);

export const activeOccupancies = () => state.occupancies.filter((o) => o.state === "active");
export const activeOccupancyOfOrder = (orderId: string) =>
  state.occupancies.find((o) => o.orderId === orderId && o.state === "active");
export const occupancyOfResource = (tankerId: string, driverId: string) =>
  state.occupancies.find((o) => o.state === "active" && (o.tankerId === tankerId || o.driverId === driverId));

export const receiptOfOrder = (orderId: string) => state.receipts.find((r) => r.orderId === orderId);
export const revisionsOfOrder = (orderId: string) =>
  state.revisions.filter((r) => r.orderId === orderId).sort((a, b) => a.at.localeCompare(b.at));

/** 今天及以后的可选装油时段 */
export const todayPlusSlots = () => state.slots.filter((s) => s.date >= todayStr());

export function nextCode(prefix: string): string {
  state.seq += 1;
  const today = todayStr().replace(/-/g, "");
  return `${prefix}${today}-${pad(state.seq)}`;
}
