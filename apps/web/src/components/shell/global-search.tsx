"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Cable, ClipboardList, Megaphone, Package, Users } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAppStore } from "@/lib/store/provider";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: Props) {
  const router = useRouter();
  const orders = useAppStore((s) => s.orders);
  const customers = useAppStore((s) => s.customers);
  const products = useAppStore((s) => s.products);
  const campaigns = useAppStore((s) => s.campaigns);
  const integrations = useAppStore((s) => s.integrations);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  // Recent orders only — the palette filters as the user types.
  const recentOrders = useMemo(() => orders.slice(0, 200), [orders]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Global search"
      description="Search orders, phones, SKUs, campaigns, and integrations"
    >
      <CommandInput placeholder="Order ID, phone, SKU, campaign, integration…" />
      <CommandList>
        <CommandEmpty>No results. Try an order ID (ORD-1042), phone, or SKU.</CommandEmpty>
        <CommandGroup heading="Orders">
          {recentOrders.map((o) => {
            const c = customerById.get(o.customerId);
            const phone = c?.identities.find((i) => i.type === "phone")?.value ?? "";
            return (
              <CommandItem
                key={o.id}
                value={`${o.id} ${c?.displayName ?? ""} ${phone} ${o.items.map((i) => i.sku).join(" ")}`}
                onSelect={() => go(`/orders/${o.id}`)}
              >
                <ClipboardList className="size-4" aria-hidden />
                <span>{o.id}</span>
                <span className="truncate text-muted-foreground">{c?.displayName}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandGroup heading="Customers">
          {customers.slice(0, 150).map((c) => (
            <CommandItem
              key={c.id}
              value={`${c.id} ${c.displayName} ${c.identities.map((i) => i.value).join(" ")}`}
              onSelect={() => go(`/customers/${c.id}`)}
            >
              <Users className="size-4" aria-hidden />
              <span>{c.displayName}</span>
              <span className="text-muted-foreground">{c.id}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Products & SKUs">
          {products.flatMap((p) =>
            p.variants.map((v) => (
              <CommandItem
                key={v.id}
                value={`${v.sku} ${p.name} ${v.aliases.join(" ")}`}
                onSelect={() => go(`/catalog/products?sku=${v.sku}`)}
              >
                <Package className="size-4" aria-hidden />
                <span>{v.sku}</span>
                <span className="truncate text-muted-foreground">{p.name}</span>
              </CommandItem>
            )),
          )}
        </CommandGroup>
        <CommandGroup heading="Campaigns">
          {campaigns.map((c) => (
            <CommandItem
              key={c.id}
              value={`${c.id} ${c.name} ${c.platform}`}
              onSelect={() => go(`/marketing?campaign=${c.id}`)}
            >
              <Megaphone className="size-4" aria-hidden />
              <span className="truncate">{c.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Integrations">
          {integrations.map((i) => (
            <CommandItem
              key={i.id}
              value={`${i.id} ${i.name} ${i.provider}`}
              onSelect={() => go(`/integrations/${i.id}`)}
            >
              <Cable className="size-4" aria-hidden />
              <span>{i.name}</span>
              <span className="text-muted-foreground">{i.status}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
