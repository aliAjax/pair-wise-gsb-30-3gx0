/** 领域模型：罐车、司机、装油时段、配送单、占用、回单、修订链、拦截记录 */

export interface Tanker {
  id: string;
  /** 车牌号 */
  plate: string;
  /** 核定载重（吨） */
  capacityTons: number;
  /** 隔仓数，>=2 才允许混装两种油品 */
  compartments: number;
  /** 年检有效期 YYYY-MM-DD */
  inspectionUntil: string;
}

export interface Driver {
  id: string;
  name: string;
  /** 从业资格证号 */
  licenseNo: string;
  /** 证件有效期 YYYY-MM-DD */
  licenseUntil: string;
}

export interface Slot {
  id: string;
  /** 装油日期 YYYY-MM-DD */
  date: string;
  /** 开始时间 HH:mm */
  start: string;
  /** 结束时间 HH:mm */
  end: string;
}

export const ORDER_STATUSES = ["待装油", "已装油", "运输中", "已到站"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface FuelLine {
  fuel: string;
  /** 计划吨数，装油后锁定 */
  plannedTons: number;
}

export interface DeliveryOrder {
  id: string;
  /** 配送单号 */
  code: string;
  station: string;
  tankerId: string;
  driverId: string;
  slotId: string;
  status: OrderStatus;
  lines: FuelLine[];
  notes: string;
  /** 装油后锁定车牌、司机、油品、吨数 */
  locked: boolean;
  createdAt: string;
  loadedAt?: string;
  departedAt?: string;
  arrivedAt?: string;
}

export type OccupancyState = "active" | "released";

export interface Occupancy {
  id: string;
  orderId: string;
  tankerId: string;
  driverId: string;
  slotId: string;
  state: OccupancyState;
  createdAt: string;
  releasedAt?: string;
  /** 到站确认释放 / 改时段释放 / 订单取消 */
  releaseReason?: string;
}

export interface ReceiptLine {
  fuel: string;
  /** 原计划值快照，回写后仍可查 */
  plannedTons: number;
  /** 实际卸油量 */
  actualTons: number;
  /** (实际-计划)/计划*100 */
  diffPct: number;
  /** 差异超过 2% 时必填 */
  reason?: string;
}

export interface Receipt {
  id: string;
  orderId: string;
  /** 回单号 */
  code: string;
  confirmedAt: string;
  lines: ReceiptLine[];
}

export interface Revision {
  id: string;
  orderId: string;
  at: string;
  /** 创建 / 改时段 / 装油 / 发车 / 到站确认 */
  type: string;
  summary: string;
}

/** 被拦截的操作，需展示车牌、人员、时段、油品和触发条件 */
export interface BlockedEvent {
  id: string;
  at: string;
  /** 触发拦截的操作：创建配送单 / 改时段 / 装油 / 发车 / 到站确认 */
  action: string;
  orderId?: string;
  orderCode?: string;
  plate: string;
  driverName: string;
  slotLabel: string;
  fuels: string;
  triggers: string[];
}

export interface State {
  version: number;
  seq: number;
  tankers: Tanker[];
  drivers: Driver[];
  slots: Slot[];
  orders: DeliveryOrder[];
  occupancies: Occupancy[];
  receipts: Receipt[];
  revisions: Revision[];
  blocked: BlockedEvent[];
}

export const STATIONS = ["城东站", "机场站", "新区站"] as const;
export const FUELS = ["92号汽油", "95号汽油", "柴油"] as const;
/** 差异超过该百分比须记录原因 */
export const DIFF_THRESHOLD_PCT = 2;
