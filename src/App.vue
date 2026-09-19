<script setup lang="ts">
import { computed, ref } from "vue";
import { ORDER_STATUSES, STATIONS } from "./domain/types";
import { activeOccupancies, resetState, state } from "./domain/store";
import BlockedPanel from "./components/BlockedPanel.vue";
import CreateOrderForm from "./components/CreateOrderForm.vue";
import OrderCard from "./components/OrderCard.vue";
import ResourceBoard from "./components/ResourceBoard.vue";

const project = {
  title: "油品配送计划",
  subtitle: "罐车、司机、装油时段、配送单与到站回单联动的发运闭环：装油锁定、到站回写、差异留痕。",
  industry: "石油",
  stack: ["Vue3", "Vite", "TypeScript", "Pinia", "Element Plus"]
} as const;

const stationFilter = ref("全部油站");
const statusFilter = ref("全部状态");

const filteredOrders = computed(() =>
  state.orders.filter((order) => {
    const byStation = stationFilter.value === "全部油站" || order.station === stationFilter.value;
    const byStatus = statusFilter.value === "全部状态" || order.status === statusFilter.value;
    return byStation && byStatus;
  })
);

const metrics = computed(() => {
  const inTransit = state.orders.filter((o) => o.status === "运输中").length;
  const plannedTons = state.orders
    .filter((o) => o.status !== "已到站")
    .flatMap((o) => o.lines)
    .reduce((sum, l) => sum + l.plannedTons, 0);
  const active = activeOccupancies();
  const tankers = new Set(active.map((o) => o.tankerId)).size;
  const drivers = new Set(active.map((o) => o.driverId)).size;
  return [
    { label: "配送单", value: state.orders.length },
    { label: "运输中", value: inTransit },
    { label: "在途计划吨数", value: plannedTons },
    { label: "占用中 车/人", value: `${tankers}/${drivers}` }
  ];
});

const chartRows = computed(() =>
  ORDER_STATUSES.map((status) => ({
    status,
    value: state.orders.filter((o) => o.status === status).length
  }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

function confirmReset() {
  if (window.confirm("重置为演示数据？当前本地修改将丢失。")) resetState();
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端 · 发运闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="topbar-side">
          <div class="stack">
            <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
          </div>
          <button type="button" class="secondary small" @click="confirmReset">重置演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article v-for="metric in metrics" :key="metric.label" class="metric">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </article>
      </section>

      <BlockedPanel />

      <section class="workspace">
        <aside class="side">
          <CreateOrderForm />
          <ResourceBoard />
        </aside>

        <section class="list-panel">
          <div class="toolbar">
            <h2>配送单列表</h2>
            <div class="filters">
              <select v-model="stationFilter">
                <option>全部油站</option>
                <option v-for="s in STATIONS" :key="s">{{ s }}</option>
              </select>
              <select v-model="statusFilter">
                <option>全部状态</option>
                <option v-for="s in ORDER_STATUSES" :key="s">{{ s }}</option>
              </select>
            </div>
          </div>

          <div class="record-grid">
            <div v-if="filteredOrders.length === 0" class="empty">暂无匹配数据</div>
            <OrderCard v-for="order in filteredOrders" :key="order.id" :order="order" />
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
    </div>
  </main>
</template>
