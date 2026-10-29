import client from '../client';
import { mapResponse, notImplemented, toLegacyPage, toLimitOffset } from './common';

// Only what the pickers need (Convert lead, Requisitions): a product list, in the legacy row shape. Money is whole cents, as the pages divide by 100.
// The Products page itself (create, edit, stock) is item 2.2, so the rest still says "not available" instead of calling a route that does not match.
export function adaptProduct(p) {
  return {
    id: p.id, sku: p.sku, name: p.name, category: p.category ?? null,
    sell_price: p.priceCents, cost_price: p.costCents,
    on_hand: p.onHand, available: p.available, reorder_level: p.reorderLevel,
    is_active: p.active ? 1 : 0,
  };
}

export const newProductsApi = {
  list: (params = {}) => {
    const { limit, offset } = toLimitOffset(params);
    const search = params.q ?? params.search;
    return mapResponse(
      client.get('/products', { params: { limit, offset, active: 'true', ...(search ? { search } : {}) } }),
      (d) => toLegacyPage(d.products.map(adaptProduct), d.total, { page: params.page, pageSize: limit }),
    );
  },
  getByBarcode: notImplemented('productsApi.getByBarcode'),
  create: notImplemented('productsApi.create'),
  update: notImplemented('productsApi.update'),
  remove: notImplemented('productsApi.remove'),
};
