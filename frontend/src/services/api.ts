import axios, { AxiosInstance } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store/authStore';

const FALLBACK_PORT = '8001';
const getRuntimeApiUrl = () => {
  if (typeof window === 'undefined' || !window.location?.hostname) return '';
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return `http://${host}:${FALLBACK_PORT}`;
  }
  const proto = window.location.protocol || 'https:';
  return `${proto}//${host}`;
};

const isWeb = typeof window !== 'undefined' && !!window.location?.hostname;
const normalizeApiBase = (value: string) => {
  const trimmed = (value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
};

const RAW_API_URL = isWeb
  ? ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? getRuntimeApiUrl()
      : (window.location.hostname === 'gestionale.sharkdrop.it'
          ? 'https://gestionale.sharkdrop.it'
          : (process.env.EXPO_PUBLIC_BACKEND_URL || getRuntimeApiUrl())))
  : (process.env.EXPO_PUBLIC_BACKEND_URL || '');

const API_URL = normalizeApiBase(RAW_API_URL);

export const getApiBaseUrl = () => API_URL;

export const getPublicWebBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }

  const explicit =
    process.env.EXPO_PUBLIC_WEB_URL ||
    process.env.EXPO_PUBLIC_FRONTEND_URL ||
    process.env.EXPO_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const backend = process.env.EXPO_PUBLIC_BACKEND_URL || '';
  if (backend) {
    try {
      const parsed = new URL(backend);
      const webPort = process.env.EXPO_PUBLIC_WEB_PORT || '19007';
      return `${parsed.protocol}//${parsed.hostname}:${webPort}`;
    } catch {
      // fall through
    }
  }

  return '';
};

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: `${API_URL}/api`,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add auth token to requests
    this.api.interceptors.request.use(async (config) => {
      let token: string | null = null;
      try {
        token = await AsyncStorage.getItem('auth_token');
      } catch {
        token = null;
      }
      if (!token && typeof window !== 'undefined') {
        try {
          token = window.localStorage?.getItem('auth_token') || null;
        } catch {
          token = null;
        }
      }
      if (!token) {
        token = useAuthStore.getState().token;
      }
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }

  // Auth
  async login(username: string, password: string) {
    const response = await this.api.post('/auth/login', { username, password });
    return response.data;
  }

  async register(username: string, password: string, role: string = 'operator') {
    const response = await this.api.post('/auth/register', { username, password, role });
    return response.data;
  }

  async getMe() {
    const response = await this.api.get('/auth/me');
    return response.data;
  }

  // Locations
  async getLocations() {
    const response = await this.api.get('/locations');
    return response.data;
  }

  async createLocation(data: { name: string; description?: string }) {
    const response = await this.api.post('/locations', data);
    return response.data;
  }

  async deleteLocation(id: string) {
    const response = await this.api.delete(`/locations/${id}`);
    return response.data;
  }

  async updateLocation(id: string, data: { name?: string; description?: string }) {
    const response = await this.api.put(`/locations/${id}`, data);
    return response.data;
  }

  // Shelves
  async getShelves(locationId?: string) {
    const params = locationId ? { location_id: locationId } : {};
    const response = await this.api.get('/shelves', { params });
    return response.data;
  }

  async getShelfByBarcode(barcode: string) {
    const response = await this.api.get(`/shelves/barcode/${barcode}`);
    return response.data;
  }

  async createShelf(data: { name: string; barcode: string; location_id: string }) {
    const response = await this.api.post('/shelves', data);
    return response.data;
  }

  async deleteShelf(id: string) {
    const response = await this.api.delete(`/shelves/${id}`);
    return response.data;
  }

  async updateShelf(id: string, data: { name?: string; barcode?: string; location_id?: string }) {
    const response = await this.api.put(`/shelves/${id}`, data);
    return response.data;
  }

  async getShelf(id: string) {
    const response = await this.api.get(`/shelves/${id}`);
    return response.data;
  }

  // Products
  async getProducts(search?: string, limit: number = 50, offset: number = 0) {
    const response = await this.api.get('/products', { params: { search, limit, offset } });
    return response.data;
  }

  async getProductByBarcode(barcode: string) {
    const response = await this.api.get(`/products/barcode/${barcode}`);
    return response.data;
  }

  async findProductByBarcode(barcode: string) {
    const normalize = (value: string) => (value || '').replace(/\D+/g, '');
    const base = normalize(barcode);
    const candidates = new Set<string>();
    if (base) {
      candidates.add(base);
      if (base.length === 12 || base.length === 13) candidates.add(`0${base}`);
      if ((base.length === 13 || base.length === 14) && base.startsWith('0')) candidates.add(base.slice(1));
    } else {
      candidates.add(barcode);
    }
    const matches = (value?: string) => {
      if (!value) return false;
      const raw = String(value).trim();
      if (raw === barcode || candidates.has(raw)) return true;
      const norm = normalize(raw);
      return !!norm && (norm === base || candidates.has(norm));
    };

    try {
      const response = await this.api.get(`/products/barcode/${barcode}`);
      return response.data;
    } catch (error: any) {
      if (error?.response?.status !== 404) {
        throw error;
      }
    }

    // Last fallback: full local catalog scan (paged) so "Ricevi/Scansiona"
    // always checks local products first before StockX flow.
    let offset = 0;
    const limit = 200;
    for (let page = 0; page < 30; page += 1) {
      const data = await this.getProducts(undefined, limit, offset);
      const products = data?.products || [];
      for (const product of products) {
        const variants = product?.variants || [];
        const match = variants.find((v: any) =>
          matches(v?.barcode) ||
          matches(v?.upc_backup) ||
          matches(v?.sku)
        );
        if (match) {
          return { product, variant: match };
        }
      }
      if (!products.length || products.length < limit) break;
      offset += limit;
    }
    const err: any = new Error('Product not found');
    err.response = { status: 404 };
    throw err;
  }

  // StockX lookup/import
  async stockxLookupBarcode(barcode: string) {
    const response = await this.api.post('/stockx/lookup', { barcode });
    return response.data;
  }

  async stockxLookupUrl(url: string, barcode?: string) {
    const response = await this.api.post('/stockx/lookup-url', { url, barcode });
    return response.data;
  }

  async stockxLookupQuery(query: string, barcode?: string) {
    const response = await this.api.post('/stockx/lookup-query', { query, barcode });
    return response.data;
  }

  async getStockxLookups(status?: string, limit: number = 50, offset: number = 0) {
    const params: any = { limit, skip: offset };
    if (status) params.status = status;
    const response = await this.api.get('/stockx/lookup', { params });
    return response.data;
  }

  async importStockxProduct(data: {
    barcode: string;
    stockx_url: string;
    product_type?: string;
    price_mode?: string;
    fixed_price_eur?: number;
    price_type_preferred?: string;
    size_mode?: string;
    eu_min?: number;
    eu_max?: number;
    eu_list?: number[];
    express_mode?: string;
    express_label?: string;
    tags?: string;
    template_suffix?: string;
    status?: string;
    default_qty?: number;
    lookup_id?: string;
  }) {
    const response = await this.api.post('/stockx/import', data);
    return response.data;
  }

  async getStockxImports(status?: string, limit: number = 50, offset: number = 0) {
    const params: any = { limit, skip: offset };
    if (status) params.status = status;
    const response = await this.api.get('/stockx/imports', { params });
    return response.data;
  }

  async getProduct(id: string) {
    const response = await this.api.get(`/products/${id}`);
    return response.data;
  }

  async updateProduct(id: string, data: { title?: string; image_url?: string }) {
    const response = await this.api.put(`/products/${id}`, data);
    return response.data;
  }

  async deleteProduct(id: string) {
    const response = await this.api.delete(`/products/${id}`);
    return response.data;
  }

  async updateVariant(productId: string, variantId: string, data: { title?: string; sku?: string; barcode?: string; price?: number }) {
    const response = await this.api.put(`/products/${productId}/variants/${variantId}`, data);
    return response.data;
  }

  // Collections
  async getCollections() {
    const response = await this.api.get('/collections');
    return response.data;
  }

  async getCollection(id: string) {
    const response = await this.api.get(`/collections/${id}`);
    return response.data;
  }

  async getCollectionProducts(id: string) {
    const response = await this.api.get(`/collections/${id}/products`);
    return response.data;
  }

  async createCollection(data: { title: string; product_ids?: string[] }) {
    const response = await this.api.post('/collections', data);
    return response.data;
  }

  async updateCollection(id: string, data: { title: string; product_ids?: string[] }) {
    const response = await this.api.put(`/collections/${id}`, data);
    return response.data;
  }

  async deleteCollection(id: string) {
    const response = await this.api.delete(`/collections/${id}`);
    return response.data;
  }

  // Inventory
  async getInventory(locationId?: string, shelfId?: string) {
    const params: any = {};
    if (locationId) params.location_id = locationId;
    if (shelfId) params.shelf_id = shelfId;
    const response = await this.api.get('/inventory', { params });
    return response.data;
  }

  async getInventorySummary(locationId?: string) {
    const params = locationId ? { location_id: locationId } : {};
    const response = await this.api.get('/inventory/summary', { params });
    return response.data;
  }

  // Inventory Operations
  async receiveInventory(data: { variant_id: string; location_id: string; shelf_id?: string; quantity: number }) {
    const response = await this.api.post('/inventory/receive', data);
    return response.data;
  }

  async moveInventory(data: { variant_id: string; location_id: string; from_shelf_id: string; to_shelf_id: string; quantity: number }) {
    const response = await this.api.post('/inventory/move', data);
    return response.data;
  }

  async transferInventory(data: { variant_id: string; from_location_id: string; to_location_id: string; from_shelf_id?: string; to_shelf_id?: string; quantity: number }) {
    const response = await this.api.post('/inventory/transfer', data);
    return response.data;
  }

  async saleInventory(data: { variant_id: string; location_id: string; shelf_id?: string; quantity: number; sale_price: number }) {
    const response = await this.api.post('/inventory/sale', data);
    return response.data;
  }

  async adjustInventory(data: { variant_id: string; location_id: string; shelf_id?: string; new_quantity: number; note?: string }) {
    const response = await this.api.post('/inventory/adjust', data);
    return response.data;
  }

  // Stallo (temporary out)
  async getStallItems(status?: string) {
    const params = status ? { status } : {};
    const response = await this.api.get('/stall-items', { params });
    return response.data;
  }

  async createStallItem(data: { variant_id: string; location_id: string; shelf_id?: string; quantity: number; note?: string; customer_name?: string }) {
    const response = await this.api.post('/stall-items', data);
    return response.data;
  }

  async returnStallItem(stallId: string, data: { to_location_id?: string; to_shelf_id?: string }) {
    const response = await this.api.post(`/stall-items/${stallId}/return`, data);
    return response.data;
  }

  async sellStallItem(stallId: string, data: { sale_price?: number }) {
    const response = await this.api.post(`/stall-items/${stallId}/sell`, data);
    return response.data;
  }

  async moveStallItem(stallId: string, data: { to_location_id: string; to_shelf_id?: string }) {
    const response = await this.api.post(`/stall-items/${stallId}/move`, data);
    return response.data;
  }

  // Transactions
  async getTransactions(limit: number = 50, offset: number = 0, type?: string) {
    const params: any = { limit, offset };
    if (type) params.transaction_type = type;
    const response = await this.api.get('/transactions', { params });
    return response.data;
  }

  // Shopify
  async syncShopify() {
    // Aggiorna TUTTI i prodotti (nuovi + esistenti con barcode aggiornati)
    const response = await this.api.post('/shopify/sync');
    return response.data;
  }

  async syncNewProducts() {
    // Sincronizza SOLO i nuovi prodotti
    const response = await this.api.post('/shopify/sync-new');
    return response.data;
  }

  async syncShopifyCollections() {
    const response = await this.api.post('/shopify/sync-collections');
    return response.data;
  }

  async getSyncStatus() {
    const response = await this.api.get('/shopify/sync-status');
    return response.data;
  }

  // Dashboard
  async getDashboardStats() {
    const response = await this.api.get('/dashboard/stats');
    return response.data;
  }

  // Export URLs
  getExportExcelUrl(locationId?: string, collectionId?: string, search?: string, size?: string, productIds?: string[], variantIds?: string[]) {
    const params = new URLSearchParams();
    if (locationId) params.append('location_id', locationId);
    if (collectionId) params.append('collection_id', collectionId);
    if (search) params.append('search', search);
    if (size) params.append('size', size);
    if (productIds && productIds.length) params.append('product_ids', productIds.join(','));
    if (variantIds && variantIds.length) params.append('variant_ids', variantIds.join(','));
    const queryString = params.toString();
    return `${API_URL}/api/export/excel${queryString ? '?' + queryString : ''}`;
  }

  getExportPdfUrl(locationId?: string, collectionId?: string, search?: string, size?: string, productIds?: string[], variantIds?: string[]) {
    const params = new URLSearchParams();
    if (locationId) params.append('location_id', locationId);
    if (collectionId) params.append('collection_id', collectionId);
    if (search) params.append('search', search);
    if (size) params.append('size', size);
    if (productIds && productIds.length) params.append('product_ids', productIds.join(','));
    if (variantIds && variantIds.length) params.append('variant_ids', variantIds.join(','));
    const queryString = params.toString();
    return `${API_URL}/api/export/pdf${queryString ? '?' + queryString : ''}`;
  }

  getExportCsvUrl(locationId?: string, collectionId?: string, search?: string, size?: string, productIds?: string[], variantIds?: string[]) {
    const params = new URLSearchParams();
    if (locationId) params.append('location_id', locationId);
    if (collectionId) params.append('collection_id', collectionId);
    if (search) params.append('search', search);
    if (size) params.append('size', size);
    if (productIds && productIds.length) params.append('product_ids', productIds.join(','));
    if (variantIds && variantIds.length) params.append('variant_ids', variantIds.join(','));
    const queryString = params.toString();
    return `${API_URL}/api/export/csv${queryString ? '?' + queryString : ''}`;
  }

  // User Management (Admin only)
  async getUsers() {
    const response = await this.api.get('/users');
    return response.data;
  }

  async createUser(data: { username: string; password: string; role: string }) {
    const response = await this.api.post('/users', data);
    return response.data;
  }

  async updateUser(userId: string, data: { password?: string; role?: string }) {
    const response = await this.api.put(`/users/${userId}`, data);
    return response.data;
  }

  async blockUser(userId: string, reason?: string) {
    const response = await this.api.post(`/users/${userId}/block`, null, { params: { reason } });
    return response.data;
  }

  async unblockUser(userId: string) {
    const response = await this.api.post(`/users/${userId}/unblock`);
    return response.data;
  }

  async deleteUser(userId: string) {
    const response = await this.api.delete(`/users/${userId}`);
    return response.data;
  }

  // Action Logs (Admin only)
  async getActionLogs(skip: number = 0, limit: number = 50, userId?: string, actionType?: string) {
    const params: any = { skip, limit };
    if (userId) params.user_id = userId;
    if (actionType) params.action_type = actionType;
    const response = await this.api.get('/logs', { params });
    return response.data;
  }

  async getUserLogs(userId: string, skip: number = 0, limit: number = 50) {
    const response = await this.api.get(`/logs/user/${userId}`, { params: { skip, limit } });
    return response.data;
  }

  async getInventoryTransactions(skip: number = 0, limit: number = 50, userId?: string, type?: string) {
    const params: any = { skip, limit };
    if (userId) params.user_id = userId;
    if (type) params.transaction_type = type;
    const response = await this.api.get('/transactions', { params });
    return response.data;
  }

  // Analytics
  async getAnalyticsSummary() {
    const response = await this.api.get('/analytics/summary');
    return response.data;
  }

  async getSales(date?: string, month?: string, fromDate?: string, toDate?: string, limit: number = 200, offset: number = 0) {
    const params: any = { limit, offset };
    if (date) params.date = date;
    if (month) params.month = month;
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;
    const response = await this.api.get('/sales', { params });
    return response.data;
  }

  getSalesCsvUrl(date?: string, month?: string, fromDate?: string, toDate?: string) {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (month) params.append('month', month);
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    const queryString = params.toString();
    return `${API_URL}/api/sales/export/csv${queryString ? '?' + queryString : ''}`;
  }

  async rollbackTransaction(transactionId: string) {
    const response = await this.api.post(`/transactions/${transactionId}/rollback`);
    return response.data;
  }

  // Shopify Inventory Sync
  async syncInventoryFromShopify() {
    const response = await this.api.post('/shopify/sync-inventory');
    return response.data;
  }

  async getInventorySyncStatus() {
    const response = await this.api.get('/shopify/inventory-sync-status');
    return response.data;
  }

  async stopInventorySync() {
    const response = await this.api.post('/shopify/sync-inventory/stop');
    return response.data;
  }

  // Shopify Orders (Da Spedire)
  async getPendingShopifyOrders() {
    const response = await this.api.get('/shopify/orders/pending');
    return response.data;
  }

  async markOrderShipped(orderId: string) {
    const response = await this.api.post(`/shopify/orders/${orderId}/mark-shipped`);
    return response.data;
  }

  async getShippedOrders(skip: number = 0, limit: number = 50) {
    const response = await this.api.get('/shopify/orders/shipped', { params: { skip, limit } });
    return response.data;
  }

  // Local Products (non-Shopify)
  async createLocalProduct(data: {
    title: string;
    description?: string;
    price: number;
    image_base64?: string;
    sku?: string;
    barcode?: string;
    variants?: { title: string; sku?: string; barcode?: string; price: number }[];
  }) {
    const response = await this.api.post('/products/local', data);
    return response.data;
  }

  async getLocalProducts() {
    const response = await this.api.get('/products/local');
    return response.data;
  }

  async pushLocalProduct(data: {
    product_id: string;
    used_tag?: boolean;
    extra_tags?: string;
    keep_photo_bg?: boolean;
  }) {
    const response = await this.api.post('/shopify/push-product', data);
    return response.data;
  }

  // Purchase Links (Acquisto da Fornitore)
  async createPurchaseLink(items: {
    product_id?: string;
    variant_id?: string;
    title: string;
    variant_title?: string;
    quantity: number;
    purchase_price: number;
  }[], note?: string, docType?: 'acquisto' | 'contovendita', identityId?: string | null) {
    const response = await this.api.post('/purchase-links', { items, note, doc_type: docType, identity_id: identityId || undefined });
    return response.data;
  }

  async getPurchaseLinks(status?: string) {
    const params = status ? { status } : {};
    const response = await this.api.get('/purchase-links', { params });
    return response.data;
  }

  async getPurchaseLink(linkId: string) {
    const response = await this.api.get(`/purchase-links/${linkId}`);
    return response.data;
  }

  async deletePurchaseLink(linkId: string) {
    const response = await this.api.delete(`/purchase-links/${linkId}`);
    return response.data;
  }

  async getPurchaseIdentities(q?: string, skip = 0, limit = 100) {
    const params: any = { skip, limit };
    if (q && q.trim()) params.q = q.trim();
    const response = await this.api.get('/purchase-identities', { params });
    return response.data;
  }

  async getPurchaseIdentity(identityId: string) {
    const response = await this.api.get(`/purchase-identities/${identityId}`);
    return response.data;
  }

  getPurchasePdfUrl(linkId: string) {
    return `${API_URL}/api/purchase-links/${linkId}/pdf`;
  }

  // Public endpoints (no auth)
  async getPublicPurchaseLink(token: string) {
    const response = await axios.get(`${API_URL}/api/public/purchase/${token}`);
    return response.data;
  }

  async submitSupplierData(token: string, data: {
    first_name: string;
    last_name: string;
    birth_date: string;
    birth_place: string;
    birth_country: string;
    residence_address: string;
    residence_city: string;
    residence_province: string;
    residence_cap: string;
    residence_country: string;
    fiscal_code: string;
    iban?: string;
    signature: string;
    phone?: string;
    email?: string;
  }) {
    const response = await axios.post(`${API_URL}/api/public/purchase/${token}/submit`, data);
    return response.data;
  }
}

export const api = new ApiService();
