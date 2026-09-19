<script setup lang="ts">
import { computed, reactive, ref } from "vue";

/* ============================== 领域类型 ============================== */

type Status = "待发车" | "运输中" | "已到站";

type FuelLine = { fuel: string; tons: number };

type Truck = {
  id: string;
  plate: string; // 车牌
  capacity: number; // 额定载重（吨）
  compartments: number; // 隔仓数：1=单隔仓，>=2 可装两种油品
  inspectionExpire: string; // 年检到期
  permitExpire: string; // 危化品运输证到期
};

type Driver = {
  id: string;
  name: string;
  licenseExpire: string; // 驾驶证到期
  qualificationExpire: string; // 危化品从业资格证到期
};

type Revision = {
  at: string;
  action: string;
  detail: string;
};

type Receipt = {
  confirmedAt: string;
  unloads: { fuel: string; planned: number; actual: number }[];
  reasons: Record<string, string>; // 差异 >2% 必须记录原因
  note: string;
};

type Order = {
  id: string;
  station: string;
  lines: FuelLine[]; // 计划油品 / 吨数（原计划值，永久保留）
  truckId: string;
  driverId: string;
  loadDate: string;
  loadStart: string;
  loadEnd: string;
  arriveAt: string;
  status: Status;
  notes: string;
  createdAt: string;
  // 装油后锁定的发车快照
  locked?: {
    plate: string;
    driverName: string;
    lines: FuelLine[];
  };
  // 到站回单
  receipt?: Receipt;
  // 修订链
  revisions: Revision[];
};

type StoreShape = {
  version: 2;
  trucks: Truck[];
  drivers: Driver[];
  orders: Order[];
};

type BlockReason = {
  condition: string; // 触发条件
  detail: string; // 具体说明
};

type AssignInput = {
  truckId: string;
  driverId: string;
  loadDate: string;
  loadStart: string;
  loadEnd: string;
  lines: { fuel: string; tons: number | undefined }[];
};

type AlertItem = {
  id: string;
  at: string;
  action: string;
  plate: string;
  person: string;
  slot: string;
  fuels: string;
  reasons: BlockReason[];
};

/* ============================== 常量与种子 ============================== */

const STORAGE_KEY = "hxwlfront-19-oil-delivery";
const STATUSES: Status[] = ["待发车", "运输中", "已到站"];
const STATIONS = ["城东站", "机场站", "新区站"];
const FUELS = ["92号汽油", "95号汽油", "柴油"];
const VARIANCE_LIMIT = 0.02;

const seedTrucks: Truck[] = [
  { id: "T001", plate: "鲁A·12345", capacity: 30, compartments: 2, inspectionExpire: "2027-03-31", permitExpire: "2027-06-30" },
  { id: "T002", plate: "鲁A·22086", capacity: 20, compartments: 1, inspectionExpire: "2027-08-31", permitExpire: "2026-08-10" },
  { id: "T003", plate: "鲁B·55210", capacity: 25, compartments: 2, inspectionExpire: "2026-10-15", permitExpire: "2027-01-20" },
  { id: "T004", plate: "鲁C·77812", capacity: 15, compartments: 1, inspectionExpire: "2026-06-30", permitExpire: "2027-05-01" }
];

const seedDrivers: Driver[] = [
  { id: "D001", name: "张建国", licenseExpire: "2028-02-01", qualificationExpire: "2027-12-31" },
  { id: "D002", name: "李海峰", licenseExpire: "2027-09-30", qualificationExpire: "2026-08-31" },
  { id: "D003", name: "王海涛", licenseExpire: "2029-05-20", qualificationExpire: "2028-03-15" },
  { id: "D004", name: "赵立军", licenseExpire: "2026-07-31", qualificationExpire: "2027-10-10" }
];

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function lockSnapshot(order: Order) {
  return {
    plate: truckMap.value[order.truckId]?.plate ?? "未知车辆",
    driverName: driverMap.value[order.driverId]?.name ?? "未知司机",
    lines: order.lines.map((line) => ({ ...line }))
  };
}

function seedOrders(): Order[] {
  const mk = (partial: Partial<Order> & { id: string; station: string; lines: FuelLine[]; truckId: string; driverId: string; loadDate: string }): Order => {
    const order: Order = {
      loadStart: "08:00",
      loadEnd: "10:00",
      arriveAt: partial.loadDate,
      status: "待发车",
      notes: "",
      createdAt: nowText(),
      revisions: [],
      ...partial
    } as Order;
    if (order.status !== "待发车") order.locked = lockSnapshot(order);
    if (!order.revisions.length) {
      order.revisions = [
        {
          at: order.createdAt,
          action: "创建配送单",
          detail: `选定 ${truckMap.value[order.truckId]?.plate} / ${driverMap.value[order.driverId]?.name}，装油时段 ${slotText(order)}，${fuelText(order.lines)}`
        }
      ];
    }
    if (order.status === "运输中") {
      order.revisions.push({
        at: order.createdAt,
        action: "装油发车",
        detail: `装油完成并发车，已锁定车牌、司机、油品、吨数：${order.locked?.plate} / ${order.locked?.driverName} / ${fuelText(order.lines)}`
      });
    }
    return order;
  };

  const list: Order[] = [
    mk({
      id: "PS20260919-001",
      station: "城东站",
      lines: [{ fuel: "92号汽油", tons: 18 }],
      truckId: "T001",
      driverId: "D001",
      loadDate: "2026-09-19",
      loadStart: "08:00",
      loadEnd: "10:00",
      arriveAt: "2026-09-19",
      status: "运输中",
      notes: "车辆已出库"
    }),
    mk({
      id: "PS20260919-002",
      station: "机场站",
      lines: [{ fuel: "柴油", tons: 12 }],
      truckId: "T003",
      driverId: "D003",
      loadDate: "2026-09-19",
      loadStart: "13:00",
      loadEnd: "15:00",
      arriveAt: "2026-09-19",
      status: "待发车",
      notes: "等待装车"
    }),
    mk({
      id: "PS20260920-003",
      station: "新区站",
      lines: [
        { fuel: "95号汽油", tons: 8 },
        { fuel: "92号汽油", tons: 7 }
      ],
      truckId: "T001",
      driverId: "D001",
      loadDate: "2026-09-20",
      loadStart: "09:00",
      loadEnd: "11:00",
      arriveAt: "2026-09-20",
      status: "待发车",
      notes: "双仓分装两种油品"
    }),
    mk({
      id: "PS20260918-004",
      station: "城东站",
      lines: [{ fuel: "92号汽油", tons: 20 }],
      truckId: "T003",
      driverId: "D003",
      loadDate: "2026-09-18",
      loadStart: "08:00",
      loadEnd: "10:00",
      arriveAt: "2026-09-18",
      status: "已到站",
      notes: "已闭环",
      receipt: {
        confirmedAt: "2026-09-18 16:20:00",
        unloads: [{ fuel: "92号汽油", planned: 20, actual: 19.5 }],
        reasons: { "92号汽油": "到站实测少卸 0.5 吨，油站罐容表计量偏差，双方共同确认。" },
        note: "差异已与油站核对签字"
      },
      revisions: [
        { at: "2026-09-18 07:50:00", action: "创建配送单", detail: "选定 鲁B·55210 / 王海涛，装油时段 2026-09-18 08:00–10:00，92号汽油 20吨" },
        { at: "2026-09-18 09:40:00", action: "装油发车", detail: "装油完成并发车，已锁定车牌、司机、油品、吨数：鲁B·55210 / 王海涛 / 92号汽油 20吨" },
        { at: "2026-09-18 16:20:00", action: "到站确认", detail: "实际卸油 19.5吨，差异 -2.50%（超过2%，已记录原因），罐车与司机占用已释放。" }
      ],
      createdAt: "2026-09-18 07:50:00"
    })
  ];
  return list;
}

/* ============================== 存储与迁移 ============================== */

const trucks = ref<Truck[]>([]);
const drivers = ref<Driver[]>([]);
const orders = ref<Order[]>([]);

const truckMap = computed<Record<string, Truck>>(() =>
  Object.fromEntries(trucks.value.map((truck) => [truck.id, truck]))
);
const driverMap = computed<Record<string, Driver>>(() =>
  Object.fromEntries(drivers.value.map((driver) => [driver.id, driver]))
);

function migrateLegacy(raw: unknown): StoreShape {
  const legacy = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const migrated: Order[] = legacy.map((record, index) => {
    const status = (record.status as Status) || "待发车";
    const lines: FuelLine[] = [{ fuel: String(record.fuel ?? ""), tons: Number(record.tons ?? 0) }];
    const base: Order = {
      id: `PS-LEGACY-${String(index + 1).padStart(2, "0")}`,
      station: String(record.station ?? ""),
      lines,
      truckId: "T001",
      driverId: "D001",
      loadDate: String(record.arriveAt ?? todayISO()),
      loadStart: "08:00",
      loadEnd: "10:00",
      arriveAt: String(record.arriveAt ?? ""),
      status,
      notes: String(record.notes ?? ""),
      createdAt: String(record.createdAt ?? nowText()),
      revisions: [
        {
          at: String(record.createdAt ?? nowText()),
          action: "数据迁移",
          detail: "由旧版配送计划迁移：默认指派 鲁A·12345 / 张建国，装油时段 08:00–10:00，请尽快改派确认。"
        }
      ]
    };
    if (status !== "待发车") {
      base.locked = {
        plate: seedTrucks[0].plate,
        driverName: seedDrivers[0].name,
        lines: lines.map((line) => ({ ...line }))
      };
    }
    return base;
  });
  return { version: 2, trucks: seedTrucks, drivers: seedDrivers, orders: migrated };
}

function loadStore(): StoreShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    trucks.value = seedTrucks.map((item) => ({ ...item }));
    drivers.value = seedDrivers.map((item) => ({ ...item }));
    const seeded = seedOrders();
    orders.value = seeded;
    return { version: 2, trucks: trucks.value, drivers: drivers.value, orders: seeded };
  }
  try {
    const parsed = JSON.parse(raw);
    const store: StoreShape =
      parsed && parsed.version === 2 && Array.isArray(parsed.orders)
        ? (parsed as StoreShape)
        : migrateLegacy(parsed);
    trucks.value = store.trucks;
    drivers.value = store.drivers;
    orders.value = store.orders;
    return store;
  } catch {
    trucks.value = seedTrucks.map((item) => ({ ...item }));
    drivers.value = seedDrivers.map((item) => ({ ...item }));
    orders.value = seedOrders();
    return { version: 2, trucks: trucks.value, drivers: drivers.value, orders: orders.value };
  }
}

loadStore();

function persist() {
  const store: StoreShape = { version: 2, trucks: trucks.value, drivers: drivers.value, orders: orders.value };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/* ============================== 展示辅助 ============================== */

function slotText(order: { loadDate: string; loadStart: string; loadEnd: string }) {
  return `${order.loadDate} ${order.loadStart || "--:--"}–${order.loadEnd || "--:--"}`;
}

function fuelText(lines: { fuel: string; tons?: number }[]) {
  return lines
    .filter((line) => line.fuel)
    .map((line) => `${line.fuel}${line.tons ? ` ${line.tons}吨` : ""}`)
    .join("、");
}

function totalTons(lines: { tons: number }[]) {
  return lines.reduce((sum, line) => sum + (Number(line.tons) || 0), 0);
}

function diffPercent(actual: number, planned: number) {
  if (!planned) return 0;
  return ((actual - planned) / planned) * 100;
}

function expireState(expire: string, refDate = todayISO()): "" | "expired" | "soon" | "ok" {
  if (!expire) return "";
  if (expire < refDate) return "expired";
  const days = (new Date(expire).getTime() - new Date(refDate).getTime()) / 86400000;
  return days <= 30 ? "soon" : "ok";
}

const expireLabel: Record<string, string> = {
  expired: "已过期",
  soon: "30日内到期",
  ok: "有效",
  "": "未填写"
};

/* ============================== 发车校验（联动核心） ============================== */

function contextText(input: AssignInput) {
  const truck = truckMap.value[input.truckId];
  const driver = driverMap.value[input.driverId];
  return {
    plate: truck ? `${truck.plate}（载重${truck.capacity}吨/${truck.compartments}隔仓）` : "未选罐车",
    person: driver ? driver.name : "未选司机",
    slot: input.loadDate ? slotText(input) : "未选装油时段",
    fuels: fuelText(input.lines) || "未选油品"
  };
}

function overlaps(a: AssignInput | Order, b: Order) {
  return (
    a.loadDate === b.loadDate &&
    (a.loadStart || "") < b.loadEnd &&
    b.loadStart < (a.loadEnd || "")
  );
}

/**
 * @param strictCredentials true=装油发车，证件/年检相对装油日期强校验；
 *                          false=建单/改派，只校验占用、载重、隔仓、时段
 */
function validateAssignment(input: AssignInput, excludeId?: string, strictCredentials = false): BlockReason[] {
  const problems: BlockReason[] = [];
  const truck = truckMap.value[input.truckId];
  const driver = driverMap.value[input.driverId];

  // 1. 基础完整性
  const missing: string[] = [];
  if (!truck) missing.push("罐车/车牌");
  if (!driver) missing.push("司机");
  if (!input.loadDate) missing.push("装油日期");
  if (!input.loadStart || !input.loadEnd) missing.push("装油起止时段");
  const validLines = input.lines.filter((line) => line.fuel && Number(line.tons) > 0);
  if (validLines.length === 0) missing.push("油品及吨数");
  if (input.lines.some((line) => line.fuel && (!line.tons || Number(line.tons) <= 0))) {
    problems.push({ condition: "吨数无效", detail: "油品吨数必须大于 0" });
  }
  const fuels = validLines.map((line) => line.fuel);
  if (new Set(fuels).size !== fuels.length) {
    problems.push({ condition: "油品重复", detail: `同一张配送单不能重复装运 ${fuels.join("、")}，请合并吨数` });
  }
  if (missing.length) {
    problems.push({ condition: "资料不完整", detail: `请先选齐：${missing.join("、")}` });
  }
  if (input.loadStart && input.loadEnd && input.loadEnd <= input.loadStart) {
    problems.push({ condition: "时段无效", detail: `装油结束时间 ${input.loadEnd} 必须晚于开始时间 ${input.loadStart}` });
  }
  if (!truck || !driver) return problems;

  // 2. 载重
  const total = totalTons(validLines);
  if (total > truck.capacity) {
    problems.push({
      condition: "超载",
      detail: `计划合计 ${total}吨 超过车牌 ${truck.plate} 额定载重 ${truck.capacity}吨`
    });
  }

  // 3. 隔仓限制：仅带隔仓（≥2 仓）的罐车能装两种油品
  if (validLines.length >= 2 && truck.compartments < 2) {
    problems.push({
      condition: "隔仓不足",
      detail: `车牌 ${truck.plate} 为单隔仓罐车，不能同时装运两种油品（${fuels.join("、")}），请改派多隔仓罐车`
    });
  }

  // 4. 人员 / 车辆时段重叠（已到站订单已释放占用，不参与冲突判断）
  for (const other of orders.value) {
    if (other.id === excludeId || other.status === "已到站") continue;
    if (overlaps(input, other)) {
      if (other.truckId === truck.id) {
        problems.push({
          condition: "罐车时段重叠",
          detail: `车牌 ${truck.plate} 在 ${slotText(input)} 已被配送单 ${other.id}（${other.station} · ${fuelText(other.lines)}）占用，需先释放或改时段`
        });
      }
      if (other.driverId === driver.id) {
        problems.push({
          condition: "司机时段重叠",
          detail: `司机 ${driver.name} 在 ${slotText(input)} 已承担配送单 ${other.id}（${other.station}），人员时段不能重叠`
        });
      }
    }
  }

  // 5. 证件 / 年检（仅发车时按装油日期强校验）
  if (strictCredentials && input.loadDate) {
    const ref = input.loadDate;
    if (truck.inspectionExpire < ref) {
      problems.push({
        condition: "罐车年检过期",
        detail: `车牌 ${truck.plate} 年检有效期至 ${truck.inspectionExpire}，早于装油日期 ${ref}，不得发车`
      });
    }
    if (truck.permitExpire < ref) {
      problems.push({
        condition: "危化品运输证失效",
        detail: `车牌 ${truck.plate} 道路运输证有效期至 ${truck.permitExpire}，装油日期 ${ref} 前已失效`
      });
    }
    if (driver.licenseExpire < ref) {
      problems.push({
        condition: "驾驶证失效",
        detail: `司机 ${driver.name} 驾驶证有效期至 ${driver.licenseExpire}，早于装油日期 ${ref}`
      });
    }
    if (driver.qualificationExpire < ref) {
      problems.push({
        condition: "从业资格证失效",
        detail: `司机 ${driver.name} 危化品从业资格证有效期至 ${driver.qualificationExpire}，装油日期 ${ref} 前已失效`
      });
    }
  }

  return problems;
}

const alerts = ref<AlertItem[]>([]);
const flash = ref("");
let flashTimer: ReturnType<typeof setTimeout> | undefined;

function pushAlert(action: string, input: AssignInput, reasons: BlockReason[]) {
  const ctx = contextText(input);
  alerts.value = [
    { id: crypto.randomUUID(), at: nowText(), action, reasons, ...ctx },
    ...alerts.value
  ].slice(0, 8);
}

function dismissAlert(id: string) {
  alerts.value = alerts.value.filter((item) => item.id !== id);
}

function pushFlash(text: string) {
  flash.value = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flash.value = ""), 3200);
}

/* ============================== 建单 / 改派 ============================== */

type FormState = {
  station: string;
  lines: { fuel: string; tons: number | undefined }[];
  truckId: string;
  driverId: string;
  loadDate: string;
  loadStart: string;
  loadEnd: string;
  arriveAt: string;
  notes: string;
};

const blankForm = (): FormState => ({
  station: "",
  lines: [{ fuel: "", tons: undefined }],
  truckId: "",
  driverId: "",
  loadDate: "",
  loadStart: "",
  loadEnd: "",
  arriveAt: "",
  notes: ""
});

const form = reactive<FormState>(blankForm());
const editingId = ref<string | null>(null);

function addLine() {
  if (form.lines.length < 2) form.lines.push({ fuel: "", tons: undefined });
}

function removeLine(index: number) {
  if (form.lines.length > 1) form.lines.splice(index, 1);
}

function fuelOptionsExcept(index: number) {
  const used = form.lines.filter((_, i) => i !== index).map((line) => line.fuel);
  return FUELS.filter((fuel) => !used.includes(fuel));
}

function formInput(): AssignInput {
  return {
    truckId: form.truckId,
    driverId: form.driverId,
    loadDate: form.loadDate,
    loadStart: form.loadStart,
    loadEnd: form.loadEnd,
    lines: form.lines
  };
}

function nextOrderId() {
  const date = todayISO().replaceAll("-", "");
  const prefix = `PS${date}-`;
  const seq = orders.value.filter((order) => order.id.startsWith(prefix)).length + 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

const formProblems = computed(() => {
  if (!form.truckId && !form.driverId && !form.loadDate) return [];
  return validateAssignment(formInput(), editingId.value ?? undefined, false);
});

function submitForm() {
  const input = formInput();
  const problems = validateAssignment(input, editingId.value ?? undefined, false);
  const action = editingId.value ? `配送单 ${editingId.value} 改时段/改派` : "创建配送单";
  if (!form.station) {
    pushAlert(action, input, [{ condition: "资料不完整", detail: "请选择目标油站" }]);
    return;
  }
  if (problems.length) {
    pushAlert(action, input, problems);
    return;
  }

  const lines = form.lines
    .filter((line) => line.fuel)
    .map((line) => ({ fuel: line.fuel, tons: Number(line.tons) }));

  if (editingId.value) {
    applyEdit(editingId.value, lines);
  } else {
    const id = nextOrderId();
    const order: Order = {
      id,
      station: form.station,
      lines,
      truckId: form.truckId,
      driverId: form.driverId,
      loadDate: form.loadDate,
      loadStart: form.loadStart,
      loadEnd: form.loadEnd,
      arriveAt: form.arriveAt,
      status: "待发车",
      notes: form.notes || "暂无备注",
      createdAt: nowText(),
      revisions: [
        {
          at: nowText(),
          action: "创建配送单",
          detail: `选定 ${truckMap.value[form.truckId].plate} / ${driverMap.value[form.driverId].name}，装油时段 ${slotText(form)}，${fuelText(lines)}，罐车与司机占用已登记`
        }
      ]
    };
    orders.value = [order, ...orders.value];
    pushFlash(`配送单 ${id} 已创建，车牌、人员的装油时段占用已登记，待装油发车。`);
  }

  Object.assign(form, blankForm());
  editingId.value = null;
  persist();
}

type EditPayload = {
  station: string;
  lines: FuelLine[];
  truckId: string;
  driverId: string;
  loadDate: string;
  loadStart: string;
  loadEnd: string;
  arriveAt: string;
  notes: string;
};

function buildDiffs(before: Order, after: EditPayload) {
  const diffs: string[] = [];
  if (before.station !== after.station) diffs.push(`目标油站：${before.station} → ${after.station}`);
  if (before.truckId !== after.truckId) {
    diffs.push(`罐车车牌：${truckMap.value[before.truckId]?.plate ?? before.truckId} → ${truckMap.value[after.truckId]?.plate ?? after.truckId}`);
  }
  if (before.driverId !== after.driverId) {
    diffs.push(`司机：${driverMap.value[before.driverId]?.name ?? before.driverId} → ${driverMap.value[after.driverId]?.name ?? after.driverId}`);
  }
  if (
    before.loadDate !== after.loadDate ||
    before.loadStart !== after.loadStart ||
    before.loadEnd !== after.loadEnd
  ) {
    diffs.push(`装油时段：${slotText(before)} → ${slotText(after)}`);
  }
  if (before.arriveAt !== after.arriveAt) diffs.push(`计划到达：${before.arriveAt || "未填"} → ${after.arriveAt || "未填"}`);
  if (fuelText(before.lines) !== fuelText(after.lines)) {
    diffs.push(`油品计划：${fuelText(before.lines)} → ${fuelText(after.lines)}（原计划值保留在修订链）`);
  }
  if ((before.notes || "") !== (after.notes || "")) diffs.push("备注已更新");
  return diffs;
}

function applyEdit(id: string, lines: FuelLine[]) {
  const index = orders.value.findIndex((order) => order.id === id);
  if (index < 0) return;
  const before = orders.value[index];
  const after = {
    station: form.station,
    truckId: form.truckId,
    driverId: form.driverId,
    loadDate: form.loadDate,
    loadStart: form.loadStart,
    loadEnd: form.loadEnd,
    arriveAt: form.arriveAt,
    notes: form.notes || before.notes
  };
  const diffs = buildDiffs(before, { ...after, lines });
  const resourceChanged =
    before.truckId !== after.truckId ||
    before.driverId !== after.driverId ||
    before.loadDate !== after.loadDate ||
    before.loadStart !== after.loadStart ||
    before.loadEnd !== after.loadEnd;
  const detail =
    diffs.join("；") + (resourceChanged ? "。原车牌/人员/时段占用已先释放，新占用校验通过后重新登记。" : "。");
  const updated: Order = { ...before, ...after, lines };
  updated.revisions = [
    ...before.revisions,
    { at: nowText(), action: "改时段/改派", detail }
  ];
  orders.value[index] = updated;
  pushFlash(`配送单 ${id} 已改派：${resourceChanged ? "原占用已释放，新占用已登记。" : "资料已更新。"}`);
}

function startEdit(order: Order) {
  editingId.value = order.id;
  Object.assign(form, {
    station: order.station,
    lines: order.lines.map((line) => ({ ...line })),
    truckId: order.truckId,
    driverId: order.driverId,
    loadDate: order.loadDate,
    loadStart: order.loadStart,
    loadEnd: order.loadEnd,
    arriveAt: order.arriveAt,
    notes: order.notes === "暂无备注" ? "" : order.notes
  });
  if (tab.value !== "orders") tab.value = "orders";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelEdit() {
  editingId.value = null;
  Object.assign(form, blankForm());
}

/* ============================== 装油发车（锁定） ============================== */

function orderInput(order: Order): AssignInput {
  return {
    truckId: order.truckId,
    driverId: order.driverId,
    loadDate: order.loadDate,
    loadStart: order.loadStart,
    loadEnd: order.loadEnd,
    lines: order.lines
  };
}

function dispatch(order: Order) {
  const problems = validateAssignment(orderInput(order), order.id, true);
  if (problems.length) {
    pushAlert(`配送单 ${order.id} 装油发车`, orderInput(order), problems);
    return;
  }
  order.status = "运输中";
  order.locked = lockSnapshot(order);
  order.revisions.push({
    at: nowText(),
    action: "装油发车",
    detail: `装油完成并发车，已锁定车牌、司机、油品、吨数：${order.locked.plate} / ${order.locked.driverName} / ${fuelText(order.locked.lines)}；占用持续至到站确认。`
  });
  persist();
  pushFlash(`配送单 ${order.id} 已发车：${order.locked.plate} · ${order.locked.driverName}，关键信息已锁定。`);
}

/* ============================== 到站回单 ============================== */

type ReceiptRow = { fuel: string; planned: number; actual: number | undefined; reason: string };

const receiptCtx = ref<{ orderId: string; rows: ReceiptRow[]; note: string } | null>(null);
const receiptError = ref("");

const receiptOrder = computed(() =>
  receiptCtx.value ? orders.value.find((order) => order.id === receiptCtx.value!.orderId) : undefined
);

function openReceipt(order: Order) {
  receiptCtx.value = {
    orderId: order.id,
    rows: order.lines.map((line) => ({ fuel: line.fuel, planned: line.tons, actual: undefined, reason: "" })),
    note: ""
  };
  receiptError.value = "";
}

function closeReceipt() {
  receiptCtx.value = null;
  receiptError.value = "";
}

function rowDiff(row: ReceiptRow) {
  if (row.actual === undefined || !row.planned) return 0;
  return diffPercent(Number(row.actual), row.planned);
}

function rowOverLimit(row: ReceiptRow) {
  return row.actual !== undefined && Math.abs(rowDiff(row)) > VARIANCE_LIMIT * 100;
}

function confirmReceipt() {
  const ctx = receiptCtx.value;
  const order = receiptOrder.value;
  if (!ctx || !order) return;

  const bad: string[] = [];
  for (const row of ctx.rows) {
    if (row.actual === undefined || Number.isNaN(Number(row.actual)) || Number(row.actual) < 0) {
      bad.push(`油品 ${row.fuel}：请填写实际卸油量（吨）`);
    } else if (rowOverLimit(row) && !row.reason.trim()) {
      bad.push(`油品 ${row.fuel}：差异 ${rowDiff(row).toFixed(2)}% 超过 2%，必须记录差异原因`);
    }
  }
  if (bad.length) {
    receiptError.value = bad.join("；");
    pushAlert(`配送单 ${order.id} 到站确认`, orderInput(order), [
      {
        condition: "回单校验未通过",
        detail: bad.join("；") + "。原计划吨数仍可查，占用暂不释放。"
      }
    ]);
    return;
  }

  const reasons: Record<string, string> = {};
  const unloads = ctx.rows.map((row) => {
    const actual = Number(row.actual);
    if (Math.abs(diffPercent(actual, row.planned)) > VARIANCE_LIMIT * 100) reasons[row.fuel] = row.reason.trim();
    return { fuel: row.fuel, planned: row.planned, actual };
  });
  const summary = unloads
    .map((item) => {
      const pct = diffPercent(item.actual, item.planned);
      const flag = Math.abs(pct) > VARIANCE_LIMIT * 100 ? `，差异 ${pct.toFixed(2)}% 已记录原因` : "";
      return `${item.fuel} 实卸 ${item.actual}吨（计划 ${item.planned}吨）${flag}`;
    })
    .join("；");

  order.receipt = { confirmedAt: nowText(), unloads, reasons, note: ctx.note.trim() };
  order.status = "已到站";
  order.revisions.push({
    at: nowText(),
    action: "到站确认",
    detail: `到站回单：${summary}。车牌与司机的装油时段占用已释放，原计划值保留可查。`
  });
  persist();
  closeReceipt();
  pushFlash(`配送单 ${order.id} 到站确认完成，占用已释放，回单已按实际卸油量回写。`);
}

/* ============================== 删除 ============================== */

function remove(order: Order) {
  if (order.status === "运输中") {
    pushAlert(`配送单 ${order.id} 删除`, orderInput(order), [
      {
        condition: "占用未释放",
        detail: "运输中订单仍占用罐车与司机，必须先完成到站回单、释放占用后才能删除。"
      }
    ]);
    return;
  }
  orders.value = orders.value.filter((item) => item.id !== order.id);
  if (editingId.value === order.id) cancelEdit();
  persist();
  pushFlash(`配送单 ${order.id} 已删除。`);
}

/* ============================== 罐车 / 司机管理 ============================== */

const truckForm = reactive({ plate: "", capacity: undefined as number | undefined, compartments: 1, inspectionExpire: "", permitExpire: "" });
const driverForm = reactive({ name: "", licenseExpire: "", qualificationExpire: "" });
const manageError = ref("");

function addTruck() {
  manageError.value = "";
  const plate = truckForm.plate.trim();
  if (!plate || !truckForm.capacity || Number(truckForm.capacity) <= 0) {
    manageError.value = "请填写车牌与大于 0 的额定载重。";
    return;
  }
  if (trucks.value.some((truck) => truck.plate === plate)) {
    manageError.value = `车牌 ${plate} 已存在，请勿重复登记。`;
    return;
  }
  if (!truckForm.inspectionExpire || !truckForm.permitExpire) {
    manageError.value = "请填写年检与危货运输证到期日。";
    return;
  }
  trucks.value.push({
    id: `T-${crypto.randomUUID().slice(0, 8)}`,
    plate,
    capacity: Number(truckForm.capacity),
    compartments: Number(truckForm.compartments),
    inspectionExpire: truckForm.inspectionExpire,
    permitExpire: truckForm.permitExpire
  });
  persist();
  Object.assign(truckForm, { plate: "", capacity: undefined, compartments: 1, inspectionExpire: "", permitExpire: "" });
  pushFlash(`罐车 ${plate} 已登记。`);
}

function addDriver() {
  manageError.value = "";
  const name = driverForm.name.trim();
  if (!name || !driverForm.licenseExpire || !driverForm.qualificationExpire) {
    manageError.value = "请填写姓名及驾驶证、从业资格证到期日。";
    return;
  }
  if (drivers.value.some((driver) => driver.name === name)) {
    manageError.value = `司机 ${name} 已存在，请勿重复登记。`;
    return;
  }
  drivers.value.push({
    id: `D-${crypto.randomUUID().slice(0, 8)}`,
    name,
    licenseExpire: driverForm.licenseExpire,
    qualificationExpire: driverForm.qualificationExpire
  });
  persist();
  Object.assign(driverForm, { name: "", licenseExpire: "", qualificationExpire: "" });
  pushFlash(`司机 ${name} 已登记。`);
}

/* ============================== 列表、指标、占用看板 ============================== */

const tab = ref<"orders" | "trucks" | "drivers">("orders");
const stationFilter = ref("全部油站");

const filteredOrders = computed(() =>
  stationFilter.value === "全部油站" ? orders.value : orders.value.filter((order) => order.station === stationFilter.value)
);

const metrics = computed(() => {
  const total = orders.value.length;
  const inTransit = orders.value.filter((order) => order.status === "运输中").length;
  const tons = orders.value.reduce((sum, order) => sum + totalTons(order.lines), 0);
  return [total, inTransit, `${tons} 吨`];
});

const chartRows = computed(() =>
  STATUSES.map((status) => ({ status, value: orders.value.filter((order) => order.status === status).length }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

const occupancyRows = computed(() =>
  orders.value
    .filter((order) => order.status !== "已到站")
    .map((order) => ({
      order,
      plate: order.locked?.plate ?? truckMap.value[order.truckId]?.plate ?? "未指派",
      person: order.locked?.driverName ?? driverMap.value[order.driverId]?.name ?? "未指派",
      slot: slotText(order),
      fuels: fuelText(order.locked?.lines ?? order.lines)
    }))
);

const metricLabels = ["配送单", "运输中", "计划总吨数"];
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业发运闭环</p>
          <h1>油品配送发运闭环</h1>
          <p class="subtitle">
            罐车 · 司机 · 配送单 · 到站回单联动：选车选人选装油时段，人员车辆时段重叠、证件失效或年检过期一律拦截；
            装油后锁定车牌/司机/油品/吨数，到站确认释放占用并按实卸量回写，差异超 2% 强制记录原因。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">Element Plus</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ metrics[index] }}</strong>
        </article>
      </section>

      <nav class="tabs">
        <button :class="{ active: tab === 'orders' }" class="secondary" type="button" @click="tab = 'orders'">
          配送单（{{ orders.length }}）
        </button>
        <button :class="{ active: tab === 'trucks' }" class="secondary" type="button" @click="tab = 'trucks'">
          罐车台账（{{ trucks.length }}）
        </button>
        <button :class="{ active: tab === 'drivers' }" class="secondary" type="button" @click="tab = 'drivers'">
          司机台账（{{ drivers.length }}）
        </button>
      </nav>

      <transition-group name="alert-stack" tag="section" class="alert-wrap">
        <div v-if="flash" key="flash" class="flash">{{ flash }}</div>
        <article v-for="alert in alerts" :key="alert.id" class="alert">
          <div class="alert-head">
            <strong>🚫 操作被拦截：{{ alert.action }}</strong>
            <span class="alert-time">{{ alert.at }}</span>
            <button type="button" class="link-btn" @click="dismissAlert(alert.id)">关闭</button>
          </div>
          <div class="alert-context">
            车牌：{{ alert.plate }} ｜ 人员：{{ alert.person }} ｜ 时段：{{ alert.slot }} ｜ 油品：{{ alert.fuels }}
          </div>
          <ul class="alert-reasons">
            <li v-for="(reason, i) in alert.reasons" :key="i">
              <em>触发条件：{{ reason.condition }}</em>
              <span>{{ reason.detail }}</span>
            </li>
          </ul>
        </article>
      </transition-group>

      <!-- ====================== 配送单 ====================== -->
      <section v-if="tab === 'orders'" class="workspace">
        <form class="panel" @submit.prevent="submitForm">
          <h2>{{ editingId ? `改派 / 改时段：${editingId}` : "创建配送单" }}</h2>
          <p v-if="editingId" class="form-hint">
            改时段或换车换人通过校验后，原车牌/人员/时段占用会先释放，再登记新占用；全部改动写入修订链。
          </p>
          <div class="form-grid">
            <label>
              目标油站
              <select v-model="form.station" required>
                <option value="">请选择</option>
                <option v-for="station in STATIONS" :key="station">{{ station }}</option>
              </select>
            </label>

            <div class="lines-block">
              <div class="lines-head">
                <span>油品与计划吨数</span>
                <button type="button" class="mini" :disabled="form.lines.length >= 2" @click="addLine">
                  + 第二种油品
                </button>
              </div>
              <p class="form-hint">同一配送单最多两种油品，且必须指派多隔仓罐车。</p>
              <div v-for="(line, index) in form.lines" :key="index" class="line-row">
                <select v-model="line.fuel" required>
                  <option value="">选择油品</option>
                  <option v-for="fuel in fuelOptionsExcept(index)" :key="fuel" :value="fuel">{{ fuel }}</option>
                </select>
                <input v-model.number="line.tons" type="number" min="0" step="0.1" placeholder="吨" required />
                <button
                  v-if="form.lines.length > 1"
                  type="button"
                  class="mini danger"
                  @click="removeLine(index)"
                >
                  移除
                </button>
              </div>
            </div>

            <label>
              罐车（车牌）
              <select v-model="form.truckId" required>
                <option value="">请选择</option>
                <option v-for="truck in trucks" :key="truck.id" :value="truck.id">
                  {{ truck.plate }}｜载重{{ truck.capacity }}吨｜{{ truck.compartments >= 2 ? truck.compartments + "隔仓" : "单隔仓" }}
                </option>
              </select>
            </label>

            <label>
              司机
              <select v-model="form.driverId" required>
                <option value="">请选择</option>
                <option v-for="driver in drivers" :key="driver.id" :value="driver.id">{{ driver.name }}</option>
              </select>
            </label>

            <label>
              装油日期
              <input v-model="form.loadDate" type="date" required />
            </label>
            <div class="time-range">
              <label>
                开始
                <input v-model="form.loadStart" type="time" required />
              </label>
              <label>
                结束
                <input v-model="form.loadEnd" type="time" required />
              </label>
            </div>
            <label>
              计划到达
              <input v-model="form.arriveAt" type="date" />
            </label>

            <label>
              备注
              <textarea v-model="form.notes" placeholder="填写处理说明或现场备注" />
            </label>

            <ul v-if="formProblems.length" class="inline-warn">
              <li v-for="(problem, i) in formProblems" :key="i">
                <em>{{ problem.condition }}</em>：{{ problem.detail }}
              </li>
            </ul>

            <div class="form-actions">
              <button type="submit">{{ editingId ? "保存改派（释放并重登记占用）" : "保存配送单并登记占用" }}</button>
              <button v-if="editingId" type="button" class="secondary" @click="cancelEdit">取消改派</button>
            </div>
          </div>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>配送单列表</h2>
            <select v-model="stationFilter">
              <option>全部油站</option>
              <option v-for="station in STATIONS" :key="station">{{ station }}</option>
            </select>
          </div>

          <div class="occupy">
            <div class="occupy-head">
              <h3>当前占用看板</h3>
              <span>{{ occupancyRows.length }} 个未释放占用（到站确认后释放）</span>
            </div>
            <div v-if="occupancyRows.length === 0" class="empty small">暂无罐车/司机占用</div>
            <table v-else class="occupy-table">
              <thead>
                <tr>
                  <th>车牌</th>
                  <th>司机</th>
                  <th>装油时段</th>
                  <th>油品</th>
                  <th>配送单</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in occupancyRows" :key="row.order.id">
                  <td>{{ row.plate }}</td>
                  <td>{{ row.person }}</td>
                  <td>{{ row.slot }}</td>
                  <td>{{ row.fuels }}</td>
                  <td>
                    {{ row.order.id }} · {{ row.order.station }}
                    <span class="status" :class="row.order.status">{{ row.order.status }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="record-grid">
            <div v-if="filteredOrders.length === 0" class="empty">暂无匹配数据</div>
            <article v-for="order in filteredOrders" :key="order.id" class="record">
              <div class="record-head">
                <div>
                  <p class="record-title">{{ order.id }} · {{ order.station }}</p>
                  <p class="record-sub">计划到达 {{ order.arriveAt || "未排期" }}</p>
                </div>
                <span class="status" :class="order.status">{{ order.status }}</span>
              </div>

              <div class="details">
                <span>
                  车牌：<b>{{ order.locked?.plate ?? truckMap[order.truckId]?.plate ?? "未指派" }}</b>
                  <i v-if="order.locked" class="lock-tag">已锁定</i>
                </span>
                <span>
                  司机：<b>{{ order.locked?.driverName ?? driverMap[order.driverId]?.name ?? "未指派" }}</b>
                  <i v-if="order.locked" class="lock-tag">已锁定</i>
                </span>
                <span>装油时段：{{ slotText(order) }}</span>
                <span>计划合计：{{ totalTons(order.lines) }} 吨</span>
              </div>

              <table class="fuel-table">
                <thead>
                  <tr>
                    <th>油品</th>
                    <th>计划吨数（原值）</th>
                    <th v-if="order.receipt">实际卸油</th>
                    <th v-if="order.receipt">差异</th>
                    <th v-if="order.receipt">差异原因</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="line in order.lines" :key="line.fuel">
                    <tr>
                      <td>{{ line.fuel }}<i v-if="order.locked" class="lock-tag">锁定</i></td>
                      <td>{{ line.tons }} 吨</td>
                      <template v-if="order.receipt">
                        <td>
                          {{ order.receipt.unloads.find((u) => u.fuel === line.fuel)?.actual ?? "—" }} 吨
                        </td>
                        <td>
                          <span
                            class="diff"
                            :class="{
                              over: Math.abs(diffPercent(order.receipt.unloads.find((u) => u.fuel === line.fuel)?.actual ?? line.tons, line.tons)) > 2
                            }"
                          >
                            {{ diffPercent(order.receipt.unloads.find((u) => u.fuel === line.fuel)?.actual ?? line.tons, line.tons).toFixed(2) }}%
                          </span>
                        </td>
                        <td>{{ order.receipt.reasons[line.fuel] || "差异在 2% 以内" }}</td>
                      </template>
                    </tr>
                  </template>
                </tbody>
              </table>

              <p v-if="order.receipt" class="note">
                回单确认于 {{ order.receipt.confirmedAt }}<template v-if="order.receipt.note">；{{ order.receipt.note }}</template>
              </p>
              <p v-else class="note">{{ order.notes }}</p>

              <details class="revisions">
                <summary>修订链（{{ order.revisions.length }}）</summary>
                <ol>
                  <li v-for="(revision, i) in order.revisions" :key="i">
                    <span class="rev-action">{{ revision.action }}</span>
                    <span class="rev-time">{{ revision.at }}</span>
                    <p>{{ revision.detail }}</p>
                  </li>
                </ol>
              </details>

              <div class="actions">
                <button v-if="order.status === '待发车'" type="button" @click="startEdit(order)">改时段/改派</button>
                <button v-if="order.status === '待发车'" type="button" @click="dispatch(order)">装油发车</button>
                <button v-if="order.status === '运输中'" type="button" @click="openReceipt(order)">到站回单</button>
                <button class="secondary" type="button" @click="remove(order)">删除</button>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>

      <!-- ====================== 罐车台账 ====================== -->
      <section v-else-if="tab === 'trucks'" class="manage">
        <form class="panel manage-form" @submit.prevent="addTruck">
          <h2>登记罐车</h2>
          <div class="form-grid">
            <label>车牌<input v-model="truckForm.plate" placeholder="如 鲁A·99999" required /></label>
            <label>额定载重（吨）<input v-model.number="truckForm.capacity" type="number" min="1" step="0.5" required /></label>
            <label>
              隔仓数
              <select v-model.number="truckForm.compartments">
                <option :value="1">1（单隔仓，仅一种油品）</option>
                <option :value="2">2（可装两种油品）</option>
                <option :value="3">3</option>
              </select>
            </label>
            <label>年检到期<input v-model="truckForm.inspectionExpire" type="date" required /></label>
            <label>危货运输证到期<input v-model="truckForm.permitExpire" type="date" required /></label>
            <button type="submit">登记罐车</button>
          </div>
        </form>

        <div class="list-panel">
          <h2>罐车台账</h2>
          <p v-if="manageError" class="inline-error">{{ manageError }}</p>
          <table class="manage-table">
            <thead>
              <tr>
                <th>车牌</th>
                <th>载重</th>
                <th>隔仓</th>
                <th>年检到期</th>
                <th>危货运输证</th>
                <th>当前占用</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="truck in trucks" :key="truck.id">
                <td><b>{{ truck.plate }}</b></td>
                <td>{{ truck.capacity }} 吨</td>
                <td>{{ truck.compartments >= 2 ? truck.compartments + " 隔仓" : "单隔仓" }}</td>
                <td>
                  {{ truck.inspectionExpire }}
                  <i class="cred" :class="expireState(truck.inspectionExpire)">{{ expireLabel[expireState(truck.inspectionExpire)] }}</i>
                </td>
                <td>
                  {{ truck.permitExpire }}
                  <i class="cred" :class="expireState(truck.permitExpire)">{{ expireLabel[expireState(truck.permitExpire)] }}</i>
                </td>
                <td>
                  <template v-for="row in occupancyRows.filter((r) => r.order.truckId === truck.id)" :key="row.order.id">
                    <span class="occupy-chip">{{ row.order.id }}｜{{ row.slot }}</span>
                  </template>
                  <span v-if="!occupancyRows.some((r) => r.order.truckId === truck.id)" class="muted">空闲</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ====================== 司机台账 ====================== -->
      <section v-else class="manage">
        <form class="panel manage-form" @submit.prevent="addDriver">
          <h2>登记司机</h2>
          <div class="form-grid">
            <label>姓名<input v-model="driverForm.name" placeholder="司机姓名" required /></label>
            <label>驾驶证到期<input v-model="driverForm.licenseExpire" type="date" required /></label>
            <label>危货从业资格证到期<input v-model="driverForm.qualificationExpire" type="date" required /></label>
            <button type="submit">登记司机</button>
          </div>
        </form>

        <div class="list-panel">
          <h2>司机台账</h2>
          <p v-if="manageError" class="inline-error">{{ manageError }}</p>
          <table class="manage-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>驾驶证到期</th>
                <th>从业资格证到期</th>
                <th>当前占用</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="driver in drivers" :key="driver.id">
                <td><b>{{ driver.name }}</b></td>
                <td>
                  {{ driver.licenseExpire }}
                  <i class="cred" :class="expireState(driver.licenseExpire)">{{ expireLabel[expireState(driver.licenseExpire)] }}</i>
                </td>
                <td>
                  {{ driver.qualificationExpire }}
                  <i class="cred" :class="expireState(driver.qualificationExpire)">{{ expireLabel[expireState(driver.qualificationExpire)] }}</i>
                </td>
                <td>
                  <template v-for="row in occupancyRows.filter((r) => r.order.driverId === driver.id)" :key="row.order.id">
                    <span class="occupy-chip">{{ row.order.id }}｜{{ row.slot }}</span>
                  </template>
                  <span v-if="!occupancyRows.some((r) => r.order.driverId === driver.id)" class="muted">空闲</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- ====================== 到站回单弹窗 ====================== -->
    <div v-if="receiptCtx && receiptOrder" class="modal-mask" @click.self="closeReceipt">
      <div class="modal">
        <h2>到站回单 · {{ receiptOrder.id }}</h2>
        <p class="form-hint">
          {{ receiptOrder.station }} ｜ {{ receiptOrder.locked?.plate }} ｜ {{ receiptOrder.locked?.driverName }} ｜
          装油时段 {{ slotText(receiptOrder) }}。按实际卸油量回写，差异超过 ±2% 必须填写原因；原计划值继续保留可查。
        </p>
        <table class="fuel-table">
          <thead>
            <tr>
              <th>油品</th>
              <th>计划吨数</th>
              <th>实际卸油（吨）</th>
              <th>差异</th>
              <th>差异原因（超 2% 必填）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in receiptCtx.rows" :key="row.fuel">
              <td>{{ row.fuel }}</td>
              <td>{{ row.planned }} 吨</td>
              <td>
                <input v-model.number="row.actual" type="number" min="0" step="0.01" placeholder="实卸吨数" />
              </td>
              <td>
                <span class="diff" :class="{ over: rowOverLimit(row) }">
                  {{ row.actual === undefined ? "—" : `${rowDiff(row).toFixed(2)}%` }}
                </span>
              </td>
              <td>
                <textarea
                  v-model="row.reason"
                  :placeholder="rowOverLimit(row) ? '差异超过 2%，请填写原因' : '差异在允许范围内'"
                  :disabled="!rowOverLimit(row)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <label class="receipt-note">
          回单备注
          <textarea v-model="receiptCtx.note" placeholder="交接签字、温密换算等补充说明" />
        </label>
        <p v-if="receiptError" class="inline-error">{{ receiptError }}</p>
        <div class="actions">
          <button type="button" @click="confirmReceipt">确认到站并释放占用</button>
          <button type="button" class="secondary" @click="closeReceipt">取消</button>
        </div>
      </div>
    </div>
  </main>
</template>
