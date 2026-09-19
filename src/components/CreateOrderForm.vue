<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { FUELS, STATIONS } from "../domain/types";
import { activeOccupancies, slotById, slotLabel, state, todayPlusSlots } from "../domain/store";
import { createOrder } from "../domain/ops";

const blankLine = () => ({ fuel: "", plannedTons: 0 });

const form = reactive({
  station: STATIONS[0] as string,
  tankerId: "",
  driverId: "",
  slotId: "",
  line1: blankLine(),
  line2: blankLine(),
  useLine2: false,
  notes: ""
});

const formError = ref("");
const justCreated = ref("");

const tanker = computed(() => state.tankers.find((t) => t.id === form.tankerId));
const canMix = computed(() => (tanker.value?.compartments ?? 0) >= 2);

watch(canMix, (allowed) => {
  if (!allowed) form.useLine2 = false;
});

/** 可选时段：今天及以后 */
const selectableSlots = computed(() => todayPlusSlots());

/** 时段占用提示 */
const occupiedHints = computed(() => {
  const hints = new Map<string, string>();
  for (const occ of activeOccupancies()) {
    const slot = slotById(occ.slotId);
    if (!slot) continue;
    const order = state.orders.find((o) => o.id === occ.orderId);
    const tanker = state.tankers.find((t) => t.id === occ.tankerId);
    const driver = state.drivers.find((d) => d.id === occ.driverId);
    hints.set(
      slot.id,
      `${tanker?.plate ?? "?"}/${driver?.name ?? "?"}→${order?.code ?? "?"}`
    );
  }
  return hints;
});

function slotOptionLabel(slotId: string): string {
  const slot = slotById(slotId);
  const hint = occupiedHints.value.get(slotId);
  return `${slotLabel(slot)}${hint ? `（占用中：${hint}）` : ""}`;
}

function submit() {
  formError.value = "";
  justCreated.value = "";
  const lines = [{ ...form.line1 }];
  if (form.useLine2 && canMix.value) lines.push({ ...form.line2 });

  if (lines.length === 2 && lines[0].fuel && lines[0].fuel === lines[1].fuel) {
    formError.value = "两条油行的油品不能相同";
    return;
  }

  const result = createOrder({
    station: form.station,
    tankerId: form.tankerId,
    driverId: form.driverId,
    slotId: form.slotId,
    lines: lines.map((l) => ({ fuel: l.fuel, plannedTons: Number(l.plannedTons) })),
    notes: form.notes.trim()
  });

  if (result.ok) {
    justCreated.value = "配送单已创建并占用所选时段";
    form.tankerId = "";
    form.driverId = "";
    form.slotId = "";
    form.line1 = blankLine();
    form.line2 = blankLine();
    form.useLine2 = false;
    form.notes = "";
  }
  // 被拦截时由 BlockedPanel 展示车牌/人员/时段/油品/触发条件
}
</script>

<template>
  <form class="panel" @submit.prevent="submit">
    <h2>创建配送单</h2>
    <div class="form-grid">
      <label>
        目标油站
        <select v-model="form.station">
          <option v-for="s in STATIONS" :key="s">{{ s }}</option>
        </select>
      </label>

      <label>
        罐车（车牌 / 载重 / 隔仓 / 年检）
        <select v-model="form.tankerId" required>
          <option value="">请选择罐车</option>
          <option v-for="t in state.tankers" :key="t.id" :value="t.id">
            {{ t.plate }}｜{{ t.capacityTons }}吨｜{{ t.compartments >= 2 ? `${t.compartments}隔仓` : "单仓" }}｜年检至 {{ t.inspectionUntil }}
          </option>
        </select>
      </label>

      <label>
        司机（从业资格证有效期）
        <select v-model="form.driverId" required>
          <option value="">请选择司机</option>
          <option v-for="d in state.drivers" :key="d.id" :value="d.id">
            {{ d.name }}｜证号 {{ d.licenseNo }}｜有效期至 {{ d.licenseUntil }}
          </option>
        </select>
      </label>

      <label>
        装油时段
        <select v-model="form.slotId" required>
          <option value="">请选择时段</option>
          <option v-for="s in selectableSlots" :key="s.id" :value="s.id">{{ slotOptionLabel(s.id) }}</option>
        </select>
      </label>

      <fieldset class="fuel-lines">
        <legend>油品与计划吨数</legend>
        <div class="fuel-line">
          <select v-model="form.line1.fuel" required>
            <option value="">油品一</option>
            <option v-for="f in FUELS" :key="f">{{ f }}</option>
          </select>
          <input v-model.number="form.line1.plannedTons" type="number" min="0.1" step="0.1" placeholder="吨数" required />
        </div>
        <div v-if="canMix" class="fuel-line-extra">
          <label class="checkbox">
            <input v-model="form.useLine2" type="checkbox" />
            第二油行（隔仓分装）
          </label>
          <div v-if="form.useLine2" class="fuel-line">
            <select v-model="form.line2.fuel" required>
              <option value="">油品二</option>
              <option v-for="f in FUELS" :key="f">{{ f }}</option>
            </select>
            <input v-model.number="form.line2.plannedTons" type="number" min="0.1" step="0.1" placeholder="吨数" required />
          </div>
        </div>
        <p v-else-if="tanker" class="hint">罐车 {{ tanker.plate }} 为单仓，仅可装一种油品</p>
      </fieldset>

      <label>
        备注
        <textarea v-model="form.notes" placeholder="填写处理说明或现场备注" />
      </label>

      <p v-if="formError" class="form-error">{{ formError }}</p>
      <p v-if="justCreated" class="form-ok">{{ justCreated }}</p>
      <button type="submit">保存配送单</button>
    </div>
  </form>
</template>
