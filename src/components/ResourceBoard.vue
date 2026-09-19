<script setup lang="ts">
import { computed } from "vue";
import { activeOccupancies, orderById, state } from "../domain/store";
import { todayStr } from "../domain/time";

const active = computed(() => activeOccupancies());

function occupantOf(kind: "tanker" | "driver", id: string) {
  const occ = active.value.find((o) => (kind === "tanker" ? o.tankerId : o.driverId) === id);
  return occ ? orderById(occ.orderId)?.code : undefined;
}
</script>

<template>
  <section class="panel resource-board">
    <h2>罐车与司机</h2>

    <h3>罐车</h3>
    <ul class="resource-list">
      <li v-for="t in state.tankers" :key="t.id">
        <div class="resource-main">
          <b>{{ t.plate }}</b>
          <span>{{ t.capacityTons }}吨 · {{ t.compartments >= 2 ? `${t.compartments}隔仓` : "单仓" }}</span>
        </div>
        <div class="resource-tags">
          <span class="chip" :class="t.inspectionUntil < todayStr() ? 'chip-bad' : 'chip-ok'">
            年检至 {{ t.inspectionUntil }}<template v-if="t.inspectionUntil < todayStr()">（已过期）</template>
          </span>
          <span v-if="occupantOf('tanker', t.id)" class="chip chip-busy">占用中 {{ occupantOf("tanker", t.id) }}</span>
          <span v-else class="chip chip-free">空闲</span>
        </div>
      </li>
    </ul>

    <h3>司机</h3>
    <ul class="resource-list">
      <li v-for="d in state.drivers" :key="d.id">
        <div class="resource-main">
          <b>{{ d.name }}</b>
          <span>证号 {{ d.licenseNo }}</span>
        </div>
        <div class="resource-tags">
          <span class="chip" :class="d.licenseUntil < todayStr() ? 'chip-bad' : 'chip-ok'">
            证件至 {{ d.licenseUntil }}<template v-if="d.licenseUntil < todayStr()">（已失效）</template>
          </span>
          <span v-if="occupantOf('driver', d.id)" class="chip chip-busy">占用中 {{ occupantOf("driver", d.id) }}</span>
          <span v-else class="chip chip-free">空闲</span>
        </div>
      </li>
    </ul>
  </section>
</template>
