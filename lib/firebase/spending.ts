import { collection, doc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from './config'
import type { Purchase } from '@/lib/spending/types'

const purchasesCol = (uid: string) => collection(db, 'users', uid, 'purchases')

export async function loadPurchases(uid: string): Promise<Purchase[]> {
  try {
    const snap = await getDocs(purchasesCol(uid))
    return snap.docs.map((d) => d.data() as Purchase)
  } catch {
    return []
  }
}

export async function savePurchase(uid: string, purchase: Purchase): Promise<void> {
  await setDoc(doc(purchasesCol(uid), purchase.id), purchase)
}

export async function updatePurchase(uid: string, id: string, updates: Partial<Purchase>): Promise<void> {
  await updateDoc(doc(purchasesCol(uid), id), updates as Record<string, unknown>)
}

export async function deletePurchase(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(purchasesCol(uid), id))
}
