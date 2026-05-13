"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type TabsContextValue = {
  value: string | undefined
}

const TabsContext = React.createContext<TabsContextValue>({
  value: undefined,
})

function composeRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (node: T) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    }
  }
}

function Tabs({
  className,
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const currentValue = value ?? internalValue

  const handleValueChange = React.useCallback(
    (nextValue: string) => {
      setInternalValue(nextValue)
      onValueChange?.(nextValue)
    },
    [onValueChange]
  )

  return (
    <TabsContext.Provider value={React.useMemo(() => ({ value: currentValue }), [currentValue])}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        value={value}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        className={cn(
          "group/tabs flex gap-2 data-horizontal:flex-col",
          className
        )}
        {...props}
      />
    </TabsContext.Provider>
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  underline = "floating",
  ref,
  style,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants> & {
    underline?: "floating" | "baseline" | "none"
  }) {
  const { value } = React.useContext(TabsContext)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [indicator, setIndicator] = React.useState({
    left: 0,
    width: 0,
    visible: false,
  })
  const shouldRenderLineIndicator = variant === "line" && underline !== "none"

  const updateIndicator = React.useCallback(() => {
    const list = listRef.current
    if (!list || !shouldRenderLineIndicator) {
      setIndicator((current) =>
        current.visible ? { left: 0, width: 0, visible: false } : current
      )
      return
    }

    const activeTab = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
    if (!activeTab) {
      setIndicator((current) =>
        current.visible ? { left: 0, width: 0, visible: false } : current
      )
      return
    }

    const listRect = list.getBoundingClientRect()
    const activeRect = activeTab.getBoundingClientRect()
    const nextIndicator = {
      left: activeRect.left - listRect.left + list.scrollLeft,
      width: activeRect.width,
      visible: true,
    }

    setIndicator((current) =>
      Math.abs(current.left - nextIndicator.left) < 0.5 &&
      Math.abs(current.width - nextIndicator.width) < 0.5 &&
      current.visible === nextIndicator.visible
        ? current
        : nextIndicator
    )
  }, [shouldRenderLineIndicator])

  React.useLayoutEffect(() => {
    updateIndicator()
  }, [updateIndicator, value, className, style])

  React.useEffect(() => {
    if (!shouldRenderLineIndicator) {
      return
    }

    const list = listRef.current
    if (!list) {
      return
    }

    const activeTab = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
    const observer = new ResizeObserver(updateIndicator)
    observer.observe(list)
    if (activeTab) {
      observer.observe(activeTab)
    }
    window.addEventListener("resize", updateIndicator)

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updateIndicator)
    }
  }, [shouldRenderLineIndicator, updateIndicator, value])

  const indicatorStyle = {
    "--tabs-line-x": `${indicator.left}px`,
    "--tabs-line-width": `${indicator.width}px`,
    "--tabs-line-opacity": indicator.visible ? 1 : 0,
    ...style,
  } as React.CSSProperties

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      data-underline={underline}
      ref={composeRefs(listRef, ref)}
      style={indicatorStyle}
      className={cn(
        tabsListVariants({ variant }),
        underline === "baseline" &&
          "relative isolate !p-0 after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:h-px after:bg-border",
        shouldRenderLineIndicator &&
          "tabs-line-indicator relative",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  underline = "floating",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  underline?: "floating" | "baseline" | "none"
}) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        underline === "baseline" || underline === "none"
          ? "h-full"
          : "h-[calc(100%-1px)]",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        underline !== "none" &&
          "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:after:hidden",
        underline === "baseline" && "group-data-horizontal/tabs:after:bottom-0",
        underline === "floating" && "group-data-horizontal/tabs:after:bottom-[-5px]",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
