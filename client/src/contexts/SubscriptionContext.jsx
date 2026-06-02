import { createContext, useContext } from 'react';

// Shares the subscription "engine" (status + mutation handlers) that lives in
// Layout.jsx so any page can open its OWN subscription modal without
// duplicating the Web Push / LINE / Smart EE wiring. Logic stays single-source
// in Layout — consumers only get the props a SubscriptionModal needs.
//
// Value shape: { currentTier, webPushSubscribed, channelStatus, onSubmit, onSendTest }
const SubscriptionContext = createContext(null);

export function useSubscription() {
    const ctx = useContext(SubscriptionContext);
    if (!ctx) {
        throw new Error('useSubscription must be used within a <SubscriptionContext.Provider> (rendered by Layout)');
    }
    return ctx;
}

export default SubscriptionContext;
