"use client"

import { Line, LineChart, ResponsiveContainer } from "recharts"

export function Sparkline({
  data,
  color = "var(--color-primary)",
  height = 32,
}: {
  data: number[]
  color?: string
  height?: number
}) {
  const chartData = data.map((v, i) => ({ i, v }))
  const isPositive = data[data.length - 1] >= data[0]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={isPositive ? "var(--color-success)" : "var(--color-destructive)"}
          strokeWidth={1.5}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
