import type {
  BlockedEvent,
  DeliveryOrder,
  Driver,
  FuelLine,
  ReceiptLine,
  Slot,
  Tanker
} from "./types";
import { DIFF_THRESHOLD_PCT } from "./types";
import {
  activeOccupancies,
  activeOccupancyOfOrder,
  driverById,
  nextCode,
  orderById,
  persist,
  slotById,
  slotLabel,
  state,
  tankerById
} from "./store";
import { nowIso, todayStr } from "./time";

export type OpResult = { ok: true } | { ok: false; blocked: BlockedEvent };

const ok: OpResult = { ok: true };

/* ---------- 校验原语 ---------- */

/** 同一日期且时间区间相交即为时段重叠 */
export function slotsOverlap(a: Slot, b: Slot): boolean {
  return a.date === b.date && a.start < b.end && b.start < a.end;
}

/** 人员/车辆时段重叠：返回触发条件描述 */
export function overlapTriggers(
  tanker: Tanker,
  driver: Driver,
  slot: Slot,
  excludeOrderId?: string
): string[] {
  const triggers: string[] = [];
  for (const occ of activeOccupancies()) {
    if (excludeOrderId && occ.orderId === excludeOrderId) continue;
    if (occ.tankerId !== tanker.id && occ.driverId !== driver.id) continue;
    const otherSlot = slotById(occ.slotId);
    if (!otherSlot || !slotsOverlap(slot, otherSlot)) continue;
    const other = orderById(occ.orderId);
    const otherCode = other ? other.code : "未知单";
    if (occ.tankerId === tanker.id) {
      triggers.push(`车辆时段重叠：${tanker.plate} 已被 ${otherCode} 占用（${slotLabel(otherSlot)}）`);
    }
    if (occ.driverId === driver.id) {
      triggers.push(`人员时段重叠：${driver.name} 已被 ${otherCode} 占用（${slotLabel(otherSlot)}）`);
    }
  }
  return triggers;
}

/** 证件失效 / 年检过期（相对指定日期） */
export function credentialTriggers(tanker: Tanker, driver: Driver, onDate: string): string[] {
  const triggers: string[] = [];
  if (driver.licenseUntil < onDate) {
    triggers.push(`证件失效：司机 ${driver.name} 从业资格证有效期至 ${driver.licenseUntil}`);
  }
  if (tanker.inspectionUntil < onDate) {
    triggers.push(`年检过期：罐车 ${tanker.plate} 年检有效期至 ${tanker.inspectionUntil}`);
  }
  return triggers;
}

/** 装载约束：隔仓混装 / 核定载重 */
export function loadingTriggers(tanker: Tanker, lines: FuelLine[]): string[] {
  const triggers: string[] = [];
  if (lines.length > 1 && tanker.compartments < 2) {
    triggers.push(`罐车 ${tanker.plate} 无隔仓，不能混装两种油品`);
  }
  const total = lines.reduce((sum, line) => sum + line.plannedTons, 0);
  if (total > tanker.capacityTons) {
    triggers.push(`合计 ${total} 吨超过罐车 ${tanker.plate} 核定载重 ${tanker.capacityTons} 吨`);
  }
  return triggers;
}

/* ---------- 拦截记录 ---------- */

function recordBlocked(
  action: string,
  ctx: { order?: DeliveryOrder; tanker?: Tanker; driver?: Driver; slot?: Slot; lines?: FuelLine[] },
  triggers: string[]
): OpResult {
  const blocked: BlockedEvent = {
    id: crypto.randomUUID(),
    at: nowIso(),
    action,
    orderId: ctx.order?.id,
    orderCode: ctx.order?.code,
    plate: ctx.tanker?.plate ?? "未选择",
    driverName: ctx.driver?.name ?? "未选择",
    slotLabel: ctx.slot ? slotLabel(ctx.slot) : "未选择",
    fuels: ctx.lines?.length ? ctx.lines.map((l) => l.fuel).join(" / ") : "未填写",
    triggers
  };
  state.blocked.unshift(blocked);
  if (state.blocked.length > 50) state.blocked.length = 50;
  persist();
  return { ok: false, blocked };
}

export function dismissBlocked(id: string): void {
  state.blocked = state.blocked.filter((b) => b.id !== id);
  persist();
}

/* ---------- 占用 ---------- */

function acquireOccupancy(order: DeliveryOrder): void {
  state.occupancies.push({
    id: crypto.randomUUID(),
    orderId: order.id,
    tankerId: order.tankerId,
    driverId: order.driverId,
    slotId: order.slotId,
    state: "active",
    createdAt: nowIso()
  });
}

function releaseOccupancy(orderId: string, reason: string): void {
  const occ = activeOccupancyOfOrder(orderId);
  if (!occ) return;
  occ.state = "released";
  occ.releasedAt = nowIso();
  occ.releaseReason = reason;
}

function addRevision(orderId: string, type: string, summary: string): void {
  state.revisions.push({ id: crypto.randomUUID(), orderId, at: nowIso(), type, summary });
}

/* ---------- 业务操作 ---------- */

export interface CreateInput {
  station: string;
  tankerId: string;
  driverId: string;
  slotId: string;
  lines: FuelLine[];
  notes: string;
}

export function createOrder(input: CreateInput): OpResult {
  const tanker = tankerById(input.tankerId);
  const driver = driverById(input.driverId);
  const slot = slotById(input.slotId);
  if (!tanker || !driver || !slot) {
    return recordBlocked("创建配送单", { tanker, driver, slot, lines: input.lines }, ["罐车、司机、装油时段均为必选"]);
  }
  if (!input.lines.length || input.lines.some((l) => !l.fuel || !(l.plannedTons > 0))) {
    return recordBlocked("创建配送单", { tanker, driver, slot, lines: input.lines }, ["油品与吨数必须填写且大于 0"]);
  }

  const triggers = [
    ...overlapTriggers(tanker, driver, slot),
    ...credentialTriggers(tanker, driver, slot.date),
    ...loadingTriggers(tanker, input.lines)
  ];
  if (triggers.length) {
    return recordBlocked("创建配送单", { tanker, driver, slot, lines: input.lines }, triggers);
  }

  const order: DeliveryOrder = {
    id: crypto.randomUUID(),
    code: nextCode("PS"),
    station: input.station,
    tankerId: tanker.id,
    driverId: driver.id,
    slotId: slot.id,
    status: "待装油",
    lines: input.lines.map((l) => ({ fuel: l.fuel, plannedTons: l.plannedTons })),
    notes: input.notes || "暂无备注",
    locked: false,
    createdAt: nowIso()
  };
  state.orders.unshift(order);
  acquireOccupancy(order);
  addRevision(
    order.id,
    "创建",
    `创建配送单：${tanker.plate} / ${driver.name} / ${slotLabel(slot)} / ` +
      order.lines.map((l) => `${l.fuel} ${l.plannedTons}吨`).join(" + ")
  );
  persist();
  return ok;
}

/** 改时段：先释放原占用，再占用新时段；新时段不可用时保留原占用并拦截 */
export function changeSlot(orderId: string, newSlotId: string): OpResult {
  const order = orderById(orderId);
  const newSlot = slotById(newSlotId);
  if (!order || !newSlot) return recordBlocked("改时段", { order, slot: newSlot }, ["订单或时段不存在"]);
  const tanker = tankerById(order.tankerId);
  const driver = driverById(order.driverId);
  if (!tanker || !driver) return recordBlocked("改时段", { order }, ["订单关联的罐车或司机不存在"]);

  if (order.locked || order.status !== "待装油") {
    return recordBlocked("改时段", { order, tanker, driver, slot: newSlot, lines: order.lines }, [
      `订单 ${order.code} 已装油锁定，车牌、司机、油品、吨数与时段不可再改`
    ]);
  }
  if (newSlot.id === order.slotId) return ok;

  const triggers = [
    ...overlapTriggers(tanker, driver, newSlot, order.id),
    ...credentialTriggers(tanker, driver, newSlot.date)
  ];
  if (triggers.length) {
    return recordBlocked("改时段", { order, tanker, driver, slot: newSlot, lines: order.lines }, triggers);
  }

  const oldSlot = slotById(order.slotId);
  // 先释放原占用，再占用新时段
  releaseOccupancy(order.id, "改时段释放");
  order.slotId = newSlot.id;
  acquireOccupancy(order);
  addRevision(
    order.id,
    "改时段",
    `释放原占用 ${slotLabel(oldSlot)}，改占用 ${slotLabel(newSlot)}`
  );
  persist();
  return ok;
}

/** 装油：通过后锁定车牌、司机、油品、吨数 */
export function loadOrder(orderId: string): OpResult {
  const order = orderById(orderId);
  if (!order) return recordBlocked("装油", {}, ["订单不存在"]);
  const tanker = tankerById(order.tankerId);
  const driver = driverById(order.driverId);
  const slot = slotById(order.slotId);
  if (!tanker || !driver || !slot) return recordBlocked("装油", { order }, ["订单关联资源缺失"]);

  if (order.status !== "待装油") {
    return recordBlocked("装油", { order, tanker, driver, slot, lines: order.lines }, [
      `订单 ${order.code} 当前状态为「${order.status}」，不能重复装油`
    ]);
  }

  const triggers = [
    ...overlapTriggers(tanker, driver, slot, order.id),
    ...credentialTriggers(tanker, driver, todayStr()),
    ...loadingTriggers(tanker, order.lines)
  ];
  if (triggers.length) {
    return recordBlocked("装油", { order, tanker, driver, slot, lines: order.lines }, triggers);
  }

  order.locked = true;
  order.status = "已装油";
  order.loadedAt = nowIso();
  addRevision(
    order.id,
    "装油",
    `装油完成并锁定：${tanker.plate} / ${driver.name} / ` +
      order.lines.map((l) => `${l.fuel} ${l.plannedTons}吨`).join(" + ")
  );
  persist();
  return ok;
}

/** 发车：人员车辆时段重叠、证件失效或年检过期不得发车 */
export function departOrder(orderId: string): OpResult {
  const order = orderById(orderId);
  if (!order) return recordBlocked("发车", {}, ["订单不存在"]);
  const tanker = tankerById(order.tankerId);
  const driver = driverById(order.driverId);
  const slot = slotById(order.slotId);
  if (!tanker || !driver || !slot) return recordBlocked("发车", { order }, ["订单关联资源缺失"]);

  if (order.status !== "已装油") {
    return recordBlocked("发车", { order, tanker, driver, slot, lines: order.lines }, [
      `订单 ${order.code} 当前状态为「${order.status}」，须先装油`
    ]);
  }

  const triggers = [
    ...overlapTriggers(tanker, driver, slot, order.id),
    ...credentialTriggers(tanker, driver, todayStr())
  ];
  if (triggers.length) {
    return recordBlocked("发车", { order, tanker, driver, slot, lines: order.lines }, triggers);
  }

  order.status = "运输中";
  order.departedAt = nowIso();
  addRevision(order.id, "发车", `发车前往 ${order.station}`);
  persist();
  return ok;
}

export interface ArrivalLineInput {
  fuel: string;
  actualTons: number;
  reason?: string;
}

/** 到站确认：回写实际卸油量，差异超 2% 须记录原因，确认后释放占用 */
export function confirmArrival(orderId: string, actuals: ArrivalLineInput[]): OpResult {
  const order = orderById(orderId);
  if (!order) return recordBlocked("到站确认", {}, ["订单不存在"]);
  const tanker = tankerById(order.tankerId);
  const driver = driverById(order.driverId);
  const slot = slotById(order.slotId);
  if (!tanker || !driver || !slot) return recordBlocked("到站确认", { order }, ["订单关联资源缺失"]);

  if (order.status !== "运输中") {
    return recordBlocked("到站确认", { order, tanker, driver, slot, lines: order.lines }, [
      `订单 ${order.code} 当前状态为「${order.status}」，不能到站确认`
    ]);
  }

  const lines: ReceiptLine[] = order.lines.map((planned) => {
    const actual = actuals.find((a) => a.fuel === planned.fuel);
    const actualTons = actual && actual.actualTons >= 0 ? actual.actualTons : NaN;
    const diffPct =
      planned.plannedTons === 0 ? (actualTons === 0 ? 0 : 100) : ((actualTons - planned.plannedTons) / planned.plannedTons) * 100;
    return {
      fuel: planned.fuel,
      plannedTons: planned.plannedTons,
      actualTons,
      diffPct: Math.round(diffPct * 10) / 10,
      reason: actual?.reason?.trim() || undefined
    };
  });

  const triggers: string[] = [];
  for (const line of lines) {
    if (Number.isNaN(line.actualTons)) {
      triggers.push(`油品 ${line.fuel} 的实际卸油量未填写或非法`);
      continue;
    }
    if (Math.abs(line.diffPct) > DIFF_THRESHOLD_PCT && !line.reason) {
      triggers.push(
        `油品 ${line.fuel} 差异 ${line.diffPct > 0 ? "+" : ""}${line.diffPct}% 超过 ${DIFF_THRESHOLD_PCT}%，须记录原因`
      );
    }
  }
  if (triggers.length) {
    return recordBlocked("到站确认", { order, tanker, driver, slot, lines: order.lines }, triggers);
  }

  const receipt = {
    id: crypto.randomUUID(),
    orderId: order.id,
    code: nextCode("HD"),
    confirmedAt: nowIso(),
    lines
  };
  state.receipts.push(receipt);
  order.status = "已到站";
  order.arrivedAt = receipt.confirmedAt;
  // 到站确认才释放占用
  releaseOccupancy(order.id, "到站确认释放");
  addRevision(
    order.id,
    "到站确认",
    `到站确认，回单 ${receipt.code}：` +
      lines
        .map((l) => {
          const diff = `${l.diffPct > 0 ? "+" : ""}${l.diffPct}%`;
          const over = Math.abs(l.diffPct) > DIFF_THRESHOLD_PCT ? `（超${DIFF_THRESHOLD_PCT}%：${l.reason}）` : "";
          return `${l.fuel} 计划${l.plannedTons}吨 实卸${l.actualTons}吨（${diff}${over}）`;
        })
        .join("；")
  );
  persist();
  return ok;
}

/** 取消订单：仅待装油可取消，级联释放占用并清理修订链 */
export function cancelOrder(orderId: string): OpResult {
  const order = orderById(orderId);
  if (!order) return recordBlocked("取消订单", {}, ["订单不存在"]);
  const tanker = tankerById(order.tankerId);
  const driver = driverById(order.driverId);
  const slot = slotById(order.slotId);

  if (order.status !== "待装油") {
    return recordBlocked("取消订单", { order, tanker, driver, slot, lines: order.lines }, [
      `订单 ${order.code} 已装油锁定，不能取消`
    ]);
  }

  releaseOccupancy(order.id, "订单取消");
  state.orders = state.orders.filter((o) => o.id !== order.id);
  state.occupancies = state.occupancies.filter((o) => o.orderId !== order.id);
  state.revisions = state.revisions.filter((r) => r.orderId !== order.id);
  persist();
  return ok;
}
