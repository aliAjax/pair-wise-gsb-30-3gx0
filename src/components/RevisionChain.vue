<script setup lang="ts">
import { computed } from "vue";
import { revisionsOfOrder } from "../domain/store";
import { fmtTime } from "../domain/time";

const props = defineProps<{ orderId: string }>();
const revisions = computed(() => revisionsOfOrder(props.orderId));
</script>

<template>
  <ol class="revision-chain">
    <li v-for="rev in revisions" :key="rev.id">
      <span class="rev-type">{{ rev.type }}</span>
      <div>
        <p>{{ rev.summary }}</p>
        <time>{{ fmtTime(rev.at) }}</time>
      </div>
    </li>
  </ol>
</template>
