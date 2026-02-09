export interface User {
  id: string;
  username: string;
  role: 'admin' | 'operator';
  is_active: boolean;
}

export interface Location {
  id: string;
  name: string;
  description?: string;
  shopify_location_id?: string;
  is_active: boolean;
}

export interface Shelf {
  id: string;
  name: string;
  barcode: string;
  location_id: string;
  is_active: boolean;
}

export interface ProductVariant {
  id: string;
  shopify_variant_id?: string;
  product_id: string;
  title: string;
  sku?: string;
  barcode?: string;
  upc_backup?: string;
  price?: number;
  inventory_item_id?: string;
  inventory_management?: string;
  inventory_quantity?: number;
}

export interface Product {
  id: string;
  shopify_product_id?: string;
  title: string;
  handle?: string;
  image_url?: string;
  image_base64?: string;
  variants: ProductVariant[];
  is_active: boolean;
}

export interface InventoryLevel {
  id: string;
  variant_id: string;
  product_id?: string;
  location_id: string;
  shelf_id?: string;
  quantity: number;
  product_title?: string;
  product_image?: string;
  variant_title?: string;
  variant_barcode?: string;
  location_name?: string;
  shelf_name?: string;
}

export interface InventoryTransaction {
  id: string;
  transaction_type: 'receive' | 'move' | 'transfer' | 'sale' | 'adjust';
  variant_id: string;
  product_id: string;
  quantity: number;
  from_location_id?: string;
  to_location_id?: string;
  from_shelf_id?: string;
  to_shelf_id?: string;
  sale_price?: number;
  note?: string;
  user_id: string;
  created_at: string;
  product_title?: string;
  variant_title?: string;
  variant_barcode?: string;
}

export interface SyncStatus {
  status: string;
  products_synced: number;
  products_created?: number;
  products_updated?: number;
  last_sync_at?: string;
  last_started_at?: string;
  last_progress_at?: string;
  last_completed_at?: string;
  mode?: string;
  error_message?: string;
}

export interface StallItem {
  id: string;
  variant_id: string;
  product_id: string;
  quantity: number;
  from_location_id: string;
  from_shelf_id?: string;
  note?: string;
  customer_name?: string;
  status: string;
  resolved_action?: string;
  to_location_id?: string;
  to_shelf_id?: string;
  created_by?: string;
  created_at: string;
  resolved_at?: string;
  product_title?: string;
  variant_title?: string;
  variant_barcode?: string;
  from_location_name?: string;
  from_shelf_name?: string;
  to_location_name?: string;
  to_shelf_name?: string;
}
