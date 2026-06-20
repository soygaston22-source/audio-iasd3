import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

const PUBLIC_KEY = "BErq5O6AdtCiF6GFZRikB8nVtXrgiSTxRogu7JLMIxlYcw2Cu32rfVmPJ9GXB2MEoDqgLL1vqzgghfBzDhegsHQ";

export async function POST(req: Request) {
  try {
    if (!process.env.VAPID_PRIVATE_KEY) {
      console.error('VAPID_PRIVATE_KEY is not set. Push notifications will not work.');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    webpush.setVapidDetails(
      'mailto:soygaston22@gmail.com',
      PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    const { username, title, body } = await req.json();

    const userDocRef = doc(db, 'users', username);
    const userDoc = await getDoc(userDocRef);
    
    if (!userDoc.exists()) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    const data = userDoc.data();
    const subscription = data.pushSubscription;
    
    if (!subscription) {
      return NextResponse.json({ error: 'No subscription found for user' }, { status: 404 });
    }
    
    const payload = JSON.stringify({
      title,
      body,
      url: '/'
    });
    
    await webpush.sendNotification(subscription, payload);
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error sending push notification:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
