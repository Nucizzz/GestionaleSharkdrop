import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { safeBack } from '../src/utils/safeBack';

interface OrderItem {
  line_item_id: number;
  title: string;
  variant_title: string;
  quantity: number;
  fulfillable_quantity: number;
  price: string;
  sku: string;
  image_base64?: string;
}

interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string;
  created_at: string;
  total_price: string;
  currency: string;
  fulfillment_status: string | null;
  customer: {
    name: string;
    email: string;
  };
  shipping_address: {
    name?: string;
    address1?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
  };
  items: OrderItem[];
  items_count: number;
}

export default function PendingOrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getPendingShopifyOrders();
      setOrders(data.orders || []);
    } catch (error: any) {
      console.error('Error loading orders:', error);
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nel caricamento ordini');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const onRefresh = () => {
    setRefreshing(true);
    loadOrders();
  };

  const toggleOrderExpand = (orderId: number) => {
    setExpandedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const handleMarkShipped = async (order: ShopifyOrder) => {
    Alert.alert(
      'Conferma Spedizione',
      `Vuoi segnare l'ordine ${order.name} come spedito?\n\nQuesta azione rimuoverà l'ordine dalla lista.`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Spedito',
          onPress: async () => {
            try {
              await api.markOrderShipped(String(order.id));
              loadOrders();
              Alert.alert('Successo', `Ordine ${order.name} segnato come spedito`);
            } catch (error: any) {
              Alert.alert('Errore', error.response?.data?.detail || 'Errore');
            }
          }
        }
      ]
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatAddress = (addr: ShopifyOrder['shipping_address']) => {
    if (!addr) return 'Indirizzo non disponibile';
    const parts = [addr.name, addr.address1, `${addr.zip || ''} ${addr.city || ''}`.trim(), addr.country].filter(Boolean);
    return parts.join(', ');
  };

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text>Caricamento ordini...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => safeBack(router)} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Da Spedire</Text>
        <TouchableOpacity onPress={loadOrders} style={styles.backButton}>
          <Ionicons name="refresh" size={22} color="#000" />
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{orders.length}</Text>
          <Text style={styles.statLabel}>Ordini in attesa</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0)}
          </Text>
          <Text style={styles.statLabel}>Prodotti totali</Text>
        </View>
      </View>

      {/* Orders List */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {orders.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={64} color="#22c55e" />
            <Text style={styles.emptyTitle}>Nessun ordine da spedire</Text>
            <Text style={styles.emptyText}>Tutti gli ordini sono stati evasi!</Text>
          </View>
        ) : (
          orders.map((order) => {
            const isExpanded = expandedOrders.has(order.id);
            return (
              <View key={order.id} style={styles.orderCard}>
                {/* Order Header */}
                <TouchableOpacity 
                  style={styles.orderHeader}
                  onPress={() => toggleOrderExpand(order.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.orderInfo}>
                    <View style={styles.orderNumberRow}>
                      <Text style={styles.orderNumber}>{order.name}</Text>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{order.items_count} prodotti</Text>
                      </View>
                    </View>
                    <Text style={styles.customerName}>{order.customer.name || 'Cliente'}</Text>
                    <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
                  </View>
                  <View style={styles.orderRight}>
                    <Text style={styles.orderTotal}>€{order.total_price}</Text>
                    <Ionicons 
                      name={isExpanded ? "chevron-up" : "chevron-down"} 
                      size={20} 
                      color="#666" 
                    />
                  </View>
                </TouchableOpacity>

                {/* Expanded Content */}
                {isExpanded && (
                  <View style={styles.orderDetails}>
                    {/* Shipping Address */}
                    <View style={styles.addressSection}>
                      <Ionicons name="location-outline" size={16} color="#666" />
                      <Text style={styles.addressText}>{formatAddress(order.shipping_address)}</Text>
                    </View>

                    {/* Items */}
                    <Text style={styles.itemsTitle}>Prodotti:</Text>
                    {order.items.map((item, idx) => (
                      <View key={idx} style={styles.itemRow}>
                        {item.image_base64 ? (
                          <Image source={{ uri: item.image_base64 }} style={styles.itemImage} />
                        ) : (
                          <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                            <Ionicons name="cube-outline" size={20} color="#999" />
                          </View>
                        )}
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                          {item.variant_title && (
                            <Text style={styles.itemVariant}>{item.variant_title}</Text>
                          )}
                          <Text style={styles.itemMeta}>
                            SKU: {item.sku || 'N/A'} • Qta: {item.quantity} • €{item.price}
                          </Text>
                        </View>
                      </View>
                    ))}

                    {/* Action Button */}
                    <TouchableOpacity
                      style={styles.shipButton}
                      onPress={() => handleMarkShipped(order)}
                    >
                      <Ionicons name="checkmark-circle" size={20} color="#fff" />
                      <Text style={styles.shipButtonText}>Segna come Spedito</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
  },
  statsBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f59e0b',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#22c55e',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  orderHeader: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
  },
  orderInfo: {
    flex: 1,
  },
  orderNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  orderNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  badge: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  customerName: {
    fontSize: 14,
    color: '#333',
    marginTop: 4,
  },
  orderDate: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  orderRight: {
    alignItems: 'flex-end',
  },
  orderTotal: {
    fontSize: 18,
    fontWeight: '700',
    color: '#22c55e',
    marginBottom: 4,
  },
  orderDetails: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  addressSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  addressText: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    lineHeight: 18,
  },
  itemsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  itemRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  itemImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  itemImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#000',
  },
  itemVariant: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  itemMeta: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  shipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22c55e',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 16,
    gap: 8,
  },
  shipButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
