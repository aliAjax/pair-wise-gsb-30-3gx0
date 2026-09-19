<script setup lang="ts">
import { computed, ref } from "vue";
import { state } from "../domain/store";
import { dismissBlocked } from "../domain/ops";
import { fmtTime } from "../domain/time";

const showHistory = ref(false);
const latest = computed(() => state.blocked[0]);
const history = computed(() => state.blocked.slice(1));
</script>

<template>
  <section v-if="latest" class="blocked-panel">
    <div class="blocked-latest">
      <div class="blocked-head">
        <strong>操作被拦截：{{ latest.action }}</strong>
        <span class="blocked-time">{{ fmtTime(latest.at) }}</span>
        <button type="button" class="secondary small" @click="dismissBlocked(latest.id)">知道了</button>
      </div>
      <div class="blocked-grid">
        <span>车牌：<b>{{ latest.plate }}</b></span>
        <span>人员：<b>{{ latest.driverName }}</b></span>
        <span>时段：<b>{{ latest.slotLabel }}</b></span>
        <span>油品：<b>{{ latest.fuels }}</b></span>
        <span v-if="latest.orderCode">关联单号：<b>{{ latest.orderCode }}</b></span>
      </div>
      <ul class="blocked-triggers">
        <li v-for="trigger in latest.triggers" :key="trigger">{{ trigger }}</li>
      </ul>
    </div>

    <div v-if="history.length" class="blocked-history">
      <button type="button" class="link" @click="showHistory = !showHistory">
        {{ showHistory ? "收起" : "展开" }}拦截记录（{{ history.length }}）
      </button>
      <div v-if="showHistory" class="blocked-history-list">
        <div v-for="event in history" :key="event.id" class="blocked-item">
          <div class="blocked-head">
            <strong>{{ event.action }}</strong>
            <span class="blocked-time">{{ fmtTime(event.at) }}</span>
            <button type="button" class="secondary small" @click="dismissBlocked(event.id)">移除</button>
          </div>
          <div class="blocked-grid">
            <span>车牌：<b>{{ event.plate }}</b></span>
            <span>人员：<b>{{ event.driverName }}</b></span>
            <span>时段：<b>{{ event.slotLabel }}</b></span>
            <span>油品：<b>{{ event.fuels }}</b></span>
          </div>
          <ul class="blocked-triggers">
            <li v-for="trigger in event.triggers" :key="trigger">{{ trigger }}</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>
