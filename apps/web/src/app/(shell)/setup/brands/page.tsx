"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Loader2, Package, Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LiveGuard } from "@/components/auth/live-guard";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import {
  createLiveBrand,
  createLiveProduct,
  createLiveVariant,
  fetchLegalEntities,
  fetchLiveBrands,
  fetchLiveCatalog,
  updateLiveBrand,
  updateLiveVariant,
  type LiveBrand,
  type LiveProduct,
  type LiveVariant,
} from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function BrandsInner() {
  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [products, setProducts] = useState<LiveProduct[]>([]);
  const [variants, setVariants] = useState<LiveVariant[]>([]);
  const [legalEntities, setLegalEntities] = useState<{ id: number; legal_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);

  const [brandDialog, setBrandDialog] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [brandCategory, setBrandCategory] = useState("");
  const [brandLegalEntity, setBrandLegalEntity] = useState<string>("");

  const [productDialog, setProductDialog] = useState(false);
  const [productName, setProductName] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [variantRows, setVariantRows] = useState([{ sku: "", name: "", price: "", cost: "", stock: "" }]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [b, cat, les] = await Promise.all([fetchLiveBrands(), fetchLiveCatalog(), fetchLegalEntities()]);
      setBrands(b);
      setProducts(cat.products);
      setVariants(cat.variants);
      setLegalEntities(les);
      setLoadError(null);
      setSelectedBrandId((cur) => cur ?? b.find((x) => !x.is_demo)?.id ?? b[0]?.id ?? null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: every setState in reload() happens after an await,
    // so nothing is set synchronously within the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const selectedBrand = brands.find((b) => b.id === selectedBrandId) ?? null;
  const brandProducts = useMemo(
    () => products.filter((p) => p.brand_id === selectedBrandId && p.status === "active"),
    [products, selectedBrandId],
  );
  const variantsByProduct = useMemo(() => {
    const map = new Map<number, LiveVariant[]>();
    for (const v of variants) {
      const list = map.get(v.product_id) ?? [];
      list.push(v);
      map.set(v.product_id, list);
    }
    return map;
  }, [variants]);

  const currencyForBrand = (b: LiveBrand | null) =>
    legalEntities.length && b?.default_legal_entity_id
      ? (b.default_legal_entity_id === legalEntities.find((l) => l.legal_name.includes("Pte"))?.id ? "SGD" : "MYR")
      : "MYR";

  async function handleCreateBrand() {
    if (!brands[0]) return;
    setBusy(true);
    try {
      await createLiveBrand({
        workspaceId: brands[0].workspace_id,
        name: brandName.trim(),
        slug: slugify(brandName),
        category: brandCategory.trim(),
        legalEntityId: brandLegalEntity ? Number(brandLegalEntity) : null,
      });
      toast.success(`Brand "${brandName.trim()}" created`);
      setBrandDialog(false);
      setBrandName("");
      setBrandCategory("");
      await reload();
    } catch (e) {
      toast.error("Could not create brand", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateProduct() {
    if (!selectedBrand) return;
    setBusy(true);
    try {
      const productId = await createLiveProduct({
        workspaceId: selectedBrand.workspace_id,
        brandId: selectedBrand.id,
        name: productName.trim(),
        category: productCategory.trim(),
      });
      const currency = currencyForBrand(selectedBrand);
      for (const row of variantRows) {
        if (!row.sku.trim()) continue;
        await createLiveVariant({
          workspaceId: selectedBrand.workspace_id,
          productId,
          sku: row.sku.trim().toUpperCase(),
          name: row.name.trim(),
          price: Number(row.price) || 0,
          currency,
          cost: row.cost ? Number(row.cost) : null,
          stock: Number(row.stock) || 0,
        });
      }
      toast.success(`Product "${productName.trim()}" created`);
      setProductDialog(false);
      setProductName("");
      setProductCategory("");
      setVariantRows([{ sku: "", name: "", price: "", cost: "", stock: "" }]);
      await reload();
    } catch (e) {
      toast.error("Could not create product", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleStockEdit(v: LiveVariant, value: string) {
    const stock = Number(value);
    if (Number.isNaN(stock) || stock === v.stock_on_hand) return;
    try {
      await updateLiveVariant(v.id, { stock_on_hand: stock });
      setVariants((cur) => cur.map((x) => (x.id === v.id ? { ...x, stock_on_hand: stock } : x)));
      toast.success(`${v.sku} stock → ${stock}`);
    } catch (e) {
      toast.error("Stock update failed", { description: (e as Error).message });
    }
  }

  return (
    <PageBody className="max-w-5xl">
      <PageHeader
        title="Brands & catalog (live)"
        description="The real workspace catalog — brands, products, SKUs, prices, and stock. Demo brands are labeled; archive them once real brands are in."
      >
        <div className="flex items-center gap-2">
          <Link href="/setup/connections" className="text-sm text-info underline-offset-2 hover:underline">
            Store connections
          </Link>
          <Button size="sm" className="gap-1.5" onClick={() => setBrandDialog(true)}>
            <Plus className="size-3.5" aria-hidden /> New brand
          </Button>
        </div>
      </PageHeader>

      {loadError && (
        <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Failed to load: {loadError}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          {/* brand list */}
          <div className="space-y-1.5">
            {brands.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedBrandId(b.id)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  b.id === selectedBrandId ? "border-ring bg-accent" : "hover:bg-accent/50",
                  b.status === "archived" && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{b.name}</span>
                  {b.is_demo && <Badge variant="outline" className="text-[9px] text-muted-foreground">demo</Badge>}
                  {b.status === "archived" && <Badge variant="outline" className="text-[9px]">archived</Badge>}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {b.category ?? "—"} · {products.filter((p) => p.brand_id === b.id && p.status === "active").length} products
                </div>
              </button>
            ))}
          </div>

          {/* brand detail */}
          <div className="space-y-3">
            {selectedBrand ? (
              <>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <Tags className="size-4 text-muted-foreground" aria-hidden />
                      {selectedBrand.name}
                      <span className="text-xs font-normal text-muted-foreground">/{selectedBrand.slug}</span>
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setProductDialog(true)}>
                        <Plus className="size-3.5" aria-hidden /> Add product
                      </Button>
                      {selectedBrand.status === "active" ? (
                        <Button
                          size="sm" variant="outline" className="gap-1.5 text-muted-foreground"
                          onClick={async () => {
                            await updateLiveBrand(selectedBrand.id, { status: "archived" });
                            toast.success(`${selectedBrand.name} archived`);
                            await reload();
                          }}
                        >
                          <Archive className="size-3.5" aria-hidden /> Archive
                        </Button>
                      ) : (
                        <Button
                          size="sm" variant="outline"
                          onClick={async () => {
                            await updateLiveBrand(selectedBrand.id, { status: "active" });
                            await reload();
                          }}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {brandProducts.length === 0 ? (
                      <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                        No products yet — add the first product and its SKUs.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {brandProducts.map((p) => (
                          <div key={p.id}>
                            <div className="mb-1.5 flex items-center gap-2">
                              <Package className="size-3.5 text-muted-foreground" aria-hidden />
                              <span className="text-sm font-medium">{p.name}</span>
                              {p.category && <span className="text-xs text-muted-foreground">{p.category}</span>}
                            </div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                  <th className="pb-1 font-medium">SKU</th>
                                  <th className="pb-1 font-medium">Variant</th>
                                  <th className="pb-1 text-right font-medium">Price</th>
                                  <th className="pb-1 text-right font-medium">Cost</th>
                                  <th className="pb-1 text-right font-medium">Stock (editable)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(variantsByProduct.get(p.id) ?? []).map((v) => (
                                  <tr key={v.id} className="border-b last:border-0">
                                    <td className="tnum py-1.5">{v.sku}</td>
                                    <td className="py-1.5">{v.name || "—"}</td>
                                    <td className="tnum py-1.5 text-right">{v.currency_code} {Number(v.price).toFixed(2)}</td>
                                    <td className="tnum py-1.5 text-right text-muted-foreground">{v.cost != null ? Number(v.cost).toFixed(2) : "—"}</td>
                                    <td className="py-1.5 text-right">
                                      <Input
                                        defaultValue={String(v.stock_on_hand)}
                                        onBlur={(e) => handleStockEdit(v, e.target.value)}
                                        className="tnum ml-auto h-6 w-20 text-right text-xs"
                                        aria-label={`Stock for ${v.sku}`}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <p className="text-[11px] text-muted-foreground">
                  Stock here is a working figure for Slice 2 — the full inventory spine (locations,
                  reservations, movement ledger) replaces it as the source of truth later. Bulk CSV import
                  can be added when you have the sheets ready.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a brand.</p>
            )}
          </div>
        </div>
      )}

      {/* new brand dialog */}
      <Dialog open={brandDialog} onOpenChange={setBrandDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New brand</DialogTitle>
            <DialogDescription>Creates a real brand in the live workspace (HQ admin only).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="b-name">Brand name</Label>
              <Input id="b-name" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. NuroKids" />
              {brandName && <p className="text-[11px] text-muted-foreground">slug: {slugify(brandName)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-cat">Category</Label>
              <Input id="b-cat" value={brandCategory} onChange={(e) => setBrandCategory(e.target.value)} placeholder="e.g. Kids supplements" />
            </div>
            <div className="space-y-1.5">
              <Label>Legal entity</Label>
              <Select value={brandLegalEntity} onValueChange={setBrandLegalEntity}>
                <SelectTrigger><SelectValue placeholder="Select entity" /></SelectTrigger>
                <SelectContent>
                  {legalEntities.map((le) => (
                    <SelectItem key={le.id} value={String(le.id)}>{le.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBrandDialog(false)}>Cancel</Button>
            <Button disabled={busy || !brandName.trim()} onClick={handleCreateBrand}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Create brand
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* new product dialog */}
      <Dialog open={productDialog} onOpenChange={setProductDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add product to {selectedBrand?.name}</DialogTitle>
            <DialogDescription>SKUs must be unique across the workspace. Prices in {currencyForBrand(selectedBrand)}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-name">Product name</Label>
                <Input id="p-name" value={productName} onChange={(e) => setProductName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-cat">Category</Label>
                <Input id="p-cat" value={productCategory} onChange={(e) => setProductCategory(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Variants / SKUs</Label>
              {variantRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_72px_72px_64px] gap-1.5">
                  <Input placeholder="SKU" value={row.sku} onChange={(e) => setVariantRows((r) => r.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))} aria-label={`Variant ${i + 1} SKU`} />
                  <Input placeholder="Variant name" value={row.name} onChange={(e) => setVariantRows((r) => r.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Variant ${i + 1} name`} />
                  <Input placeholder="Price" inputMode="decimal" value={row.price} onChange={(e) => setVariantRows((r) => r.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} aria-label={`Variant ${i + 1} price`} />
                  <Input placeholder="Cost" inputMode="decimal" value={row.cost} onChange={(e) => setVariantRows((r) => r.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} aria-label={`Variant ${i + 1} cost`} />
                  <Input placeholder="Stock" inputMode="numeric" value={row.stock} onChange={(e) => setVariantRows((r) => r.map((x, j) => (j === i ? { ...x, stock: e.target.value } : x)))} aria-label={`Variant ${i + 1} stock`} />
                </div>
              ))}
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setVariantRows((r) => [...r, { sku: "", name: "", price: "", cost: "", stock: "" }])}>
                <Plus className="size-3" aria-hidden /> Add variant row
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductDialog(false)}>Cancel</Button>
            <Button disabled={busy || !productName.trim() || !variantRows.some((r) => r.sku.trim())} onClick={handleCreateProduct}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Create product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

export default function BrandsSetupPage() {
  return (
    <LiveGuard>
      <BrandsInner />
    </LiveGuard>
  );
}
