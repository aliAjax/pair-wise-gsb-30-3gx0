<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { DeliveryOrder } from "../domain/types";
import { DIFF_THRESHOLD_PCT } from "../domain/types";
import {
  driverById,
  receiptOfOrder,
  slotById,
  slotLabel,
  tankerById,
  todayPlusSlots
} from "../domain/store";
import { cancelOrder, changeSlot, confirmArrival, departOrder, loadOrder } from "../domain/ops";
import { fmtTime } from "../domain/time";
import RevisionChain from "./RevisionChain.vue";

const props = defineProps<{ order: DeliveryOrder }>();

const tanker = computed(() => tankerById(props.order.tankerId));
const driver = computed(() => driverById(props.order.driverId));
const slot = computed(() => slotById(props.order.slotId));
const receipt = computed(() => receiptOfOrder(props.order.id));

/* 改时段 */
const pickedSlotId = ref(props.order.slotId);
watch(
  () => props.order.slotId,
  (slotId) => { pickedSlotId.value = slotId; }
);
const selectableSlots = computed(() => todayPlusSlots());

function submitSlotChange() {
  const result = changeSlot(props.order.id, pickedSlotId.value);
  if (!result.ok) pickedSlotId.value = props.order.slotId;
}

/* 到站确认表单 */
const showArrival = ref(false);
const arrivalLines = reactive(
  props.order.lines.map((l) => ({ fuel: l.fuel, actualTons: l.plannedTons as number, reason: "" }))
);

function diffPctOf(line: { fuel: string; actualTons: number }): number {
  const planned = props.order.lines.find((l) => l.fuel === line.fuel)?.plannedTons ?? 0;
  if (planned === 0) return line.actualTons === 0 ? 0 : 100;
  return Math.round(((line.actualTons - planned) / planned) * 1000) / 10;
}

function needsReason(line: { fuel: string; actualTons: number }): boolean {
  return Math.abs(diffPctOf(line)) > DIFF_THRESHOLD_PCT;
}

function submitArrival() {
  const result = confirmArrival(
    props.order.id,
    arrivalLines.map((l) => ({ fuel: l.fuel, actualTons: Number(l.actualTons), reason: l.reason }))
  );
  if (result.ok) showArrival.value = false;
}

/* 修订链 */
const showRevisions = ref(false);

const statusClass = computed(() => `status-${props.order.status}`);
</script>

<template>
  <article class="record">
    <div class="record-head">
      <p class="record-title">{{ order.code }} · {{ order.station }}</p>
      <span class="status" :class="statusClass">{{ order.status }}</span>
    </div>

    <div class="details">
      <span>车牌：{{ tanker?.plate ?? "?" }}（{{ (tanker?.compartments ?? 0) >= 2 ? `${tanker?.compartments}隔仓` : "单仓" }}）</span>
      <span>司机：{{ driver?.name ?? "?" }}（证件至 {{ driver?.licenseUntil ?? "?" }}）</span>
      <span>装油时段：{{ slotLabel(slot) }}</span>
      <span>年检：{{ tanker?.inspectionUntil ?? "?" }}</span>
      <span v-for="line in order.lines" :key="line.fuel">
        油品：{{ line.fuel }} 计划 {{ line.plannedTons }} 吨
        <template v-if="order.locked">🔒</template>
      </span>
      <span v-if="order.locked" class="locked-tag">已装油锁定：车牌 / 司机 / 油品 / 吨数</span>
    </div>

    <p class="note">{{ order.notes }}</p>

    <!-- 到站回单：原计划值与实卸量对照 -->
    <div v-if="receipt" class="receipt">
      <div class="receipt-head">
        <strong>到站回单 {{ receipt.code }}</strong>
        <span>确认于 {{ fmtTime(receipt.confirmedAt) }}</span>
      </div>
      <table>
        <thead>
          <tr><th>油品</th><th>计划(吨)</th><th>实卸(吨)</th><th>差异</th><th>原因</th></tr>
        </thead>
        <tbody>
          <tr v-for="line in receipt.lines" :key="line.fuel">
            <td>{{ line.fuel }}</td>
            <td>{{ line.plannedTons }}</td>
            <td>{{ line.actualTons }}</td>
            <td :class="{ 'diff-over': Math.abs(line.diffPct) > DIFF_THRESHOLD_PCT }">
              {{ line.diffPct > 0 ? "+" : "" }}{{ line.diffPct }}%
            </td>
            <td>{{ line.reason ?? "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 改时段（仅待装油） -->
    <div v-if="order.status === '待装油'" class="slot-change">
      <select v-model="pickedSlotId">
        <option v-for="s in selectableSlots" :key="s.id" :value="s.id">{{ slotLabel(s) }}</option>
      </select>
      <button type="button" class="secondary" :disabled="pickedSlotId === order.slotId" @click="submitSlotChange">
        改时段（先释放原占用）
      </button>
    </div>

    <!-- 到站确认表单 -->
    <div v-if="order.status === '运输中' && showArrival" class="arrival-form">
      <div v-for="line in arrivalLines" :key="line.fuel" class="arrival-line">
        <div class="arrival-row">
          <span>{{ line.fuel }}（计划 {{ order.lines.find((l) => l.fuel === line.fuel)?.plannedTons }} 吨）</span>
          <input v-model.number="line.actualTons" type="number" min="0" step="0.1" placeholder="实卸吨数" />
          <span class="diff-badge" :class="{ 'diff-over': needsReason(line) }">
            差异 {{ diffPctOf(line) > 0 ? "+" : "" }}{{ diffPctOf(line) }}%
          </span>
        </div>
        <input
          v-if="needsReason(line)"
          v-model="line.reason"
          type="text"
          :placeholder="`差异超过 ${DIFF_THRESHOLD_PCT}%，必须记录原因`"
          class="reason-input"
        />
      </div>
      <button type="button" @click="submitArrival">确认到站并释放占用</button>
    </div>

    <div class="actions">
      <button v-if="order.status === '待装油'" type="button" @click="loadOrder(order.id)">装油并锁定</button>
      <button v-if="order.status === '已装油'" type="button" @click="departOrder(order.id)">发车</button>
      <button v-if="order.status === '运输中' && !showArrival" type="button" @click="showArrival = true">到站确认</button>
      <button v-if="order.status === '待装油'" type="button" class="danger" @click="cancelOrder(order.id)">取消订单</button>
      <button type="button" class="secondary" @click="showRevisions = !showRevisions">
        {{ showRevisions ? "收起" : "修订链" }}
      </button>
    </div>

    <RevisionChain v-if="showRevisions" :order-id="order.id" />
  </article>
</template>
