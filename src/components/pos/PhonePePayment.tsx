"use client";

import { useState, useEffect } from "react";
import { X, Loader2, CheckCircle2, XCircle, Phone, ExternalLink } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { initiatePayment, checkPaymentStatus, toPaise, type PaymentStatusResponse } from "@/lib/phonepe";

interface PhonePePaymentProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (transactionId: string, phonePeTransactionId?: string) => void;
    onFailure: (error: string) => void;
    amount: number; // Amount in rupees
    orderId: string;
}

type PaymentStatus = 'input' | 'initiating' | 'pending' | 'success' | 'failed';

export function PhonePePayment({
    isOpen,
    onClose,
    onSuccess,
    onFailure,
    amount,
    orderId,
}: PhonePePaymentProps) {
    const [status, setStatus] = useState<PaymentStatus>('input');
    const [customerPhone, setCustomerPhone] = useState('');
    const [transactionId, setTransactionId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pollCount, setPollCount] = useState(0);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setStatus('input');
            setCustomerPhone('');
            setTransactionId(null);
            setError(null);
            setPollCount(0);
        }
    }, [isOpen]);



    // Poll for payment status when pending
    useEffect(() => {
        if (status !== 'pending' || !transactionId) return;

        const pollInterval = setInterval(async () => {
            try {
                const data = await checkPaymentStatus(transactionId);

                if (data.success) {
                    if (data.code === 'PAYMENT_SUCCESS') {
                        setStatus('success');
                        clearInterval(pollInterval);
                        setTimeout(() => {
                            onSuccess(transactionId, data.transactionId);
                        }, 2000);
                    } else if (data.code === 'PAYMENT_ERROR' || data.code === 'PAYMENT_DECLINED') {
                        setStatus('failed');
                        setError(data.message || 'Payment failed');
                        clearInterval(pollInterval);
                    }
                }

                setPollCount(prev => prev + 1);

                // Stop polling after 2 minutes (40 polls at 3s interval)
                if (pollCount >= 40) {
                    clearInterval(pollInterval);
                    setError('Payment verification timed out. Please check your payment status manually.');
                }
            } catch (err) {
                console.error('Status poll error:', err);
            }
        }, 3000);

        return () => clearInterval(pollInterval);
    }, [status, transactionId, pollCount, onSuccess]);

    const handleInitiatePayment = async () => {
        setStatus('initiating');
        setError(null);

        try {
            // Initiate payment directly using client-side library
            // Note: In production, credentials should properly properly proxies or secured, 
            // but for Tauri desktop app usage, this is acceptable.
            const result = await initiatePayment({
                amount: toPaise(amount), // Convert to paise
                orderId: orderId,
                customerPhone: customerPhone || undefined,
                redirectUrl: window.location.origin + '/pos?payment=callback&orderId=' + orderId,
                callbackUrl: window.location.origin + '/pos', // Not used effectively without server
            });

            if (result.success && result.redirectUrl) {
                setTransactionId(result.transactionId);
                setStatus('pending');

                // Open PhonePe payment page in new window
                window.open(result.redirectUrl, '_blank', 'width=500,height=700');
            } else {
                setStatus('failed');
                setError(result.error || 'Failed to initiate payment');
            }
        } catch (err) {
            setStatus('failed');
            setError(err instanceof Error ? err.message : 'Network error');
        }
    };

    const handleRetry = () => {
        setStatus('input');
        setError(null);
        setTransactionId(null);
        setPollCount(0);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-surface-navy rounded-xl shadow-2xl max-w-md w-full border border-surface-hover overflow-hidden">
                {/* Header */}
                <div className="bg-bg-navy p-4 flex items-center justify-between border-b border-surface-hover">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#5f259f] rounded-lg flex items-center justify-center">
                            <span className="text-white font-bold text-sm">Pe</span>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">PhonePe Payment</h3>
                            <p className="text-sm text-moonstone">{formatPrice(amount)}</p>
                        </div>
                    </div>
                    {status === 'input' && (
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-lg text-moonstone hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="p-6">
                    {/* Phone Input Stage */}
                    {status === 'input' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-moonstone mb-2">
                                    Customer Phone Number <span className="text-moonstone/60">(Optional)</span>
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone">
                                        <Phone size={18} />
                                    </div>
                                    <input
                                        type="tel"
                                        placeholder="Enter 10-digit phone number"
                                        value={customerPhone}
                                        onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                        className="bg-bg-navy border border-surface-hover text-white text-sm rounded-lg block w-full pl-10 h-12 focus:ring-1 focus:ring-primary focus:border-primary placeholder-moonstone/60 transition-all"
                                    />
                                </div>
                                <p className="text-xs text-moonstone/60 mt-1">
                                    Phone number helps with faster UPI payments
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={handleInitiatePayment}
                                    className="flex-1 bg-[#5f259f] hover:bg-[#4a1d7c] text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <ExternalLink size={18} />
                                    Pay {formatPrice(amount)}
                                </button>
                                <button
                                    onClick={onClose}
                                    className="px-4 bg-bg-navy border border-surface-hover text-moonstone hover:text-white font-medium py-3 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Initiating Stage */}
                    {status === 'initiating' && (
                        <div className="text-center py-8">
                            <Loader2 size={48} className="text-[#5f259f] animate-spin mx-auto mb-4" />
                            <p className="text-white font-medium">Initiating payment...</p>
                            <p className="text-sm text-moonstone mt-1">Please wait</p>
                        </div>
                    )}

                    {/* Pending Stage */}
                    {status === 'pending' && (
                        <div className="text-center py-8">
                            <div className="relative mx-auto w-16 h-16 mb-4">
                                <div className="absolute inset-0 bg-[#5f259f]/20 rounded-full animate-ping" />
                                <div className="relative w-16 h-16 bg-[#5f259f] rounded-full flex items-center justify-center">
                                    <Loader2 size={28} className="text-white animate-spin" />
                                </div>
                            </div>
                            <p className="text-white font-medium">Complete payment in PhonePe</p>
                            <p className="text-sm text-moonstone mt-1">
                                A new window has opened for payment
                            </p>
                            <p className="text-xs text-moonstone/60 mt-4">
                                Checking payment status... ({pollCount}/40)
                            </p>
                            {transactionId && (
                                <p className="text-xs text-moonstone/40 mt-2 font-mono">
                                    Txn: {transactionId}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Success Stage */}
                    {status === 'success' && (
                        <div className="text-center py-8">
                            <CheckCircle2 size={64} className="text-green-500 mx-auto mb-4" />
                            <p className="text-white text-xl font-bold">Payment Successful!</p>
                            <p className="text-sm text-moonstone mt-1">
                                {formatPrice(amount)} received
                            </p>
                            {transactionId && (
                                <p className="text-xs text-moonstone/60 mt-4 font-mono">
                                    Transaction ID: {transactionId}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Failed Stage */}
                    {status === 'failed' && (
                        <div className="text-center py-8">
                            <XCircle size={64} className="text-red-500 mx-auto mb-4" />
                            <p className="text-white text-xl font-bold">Payment Failed</p>
                            <p className="text-sm text-red-400 mt-1">{error}</p>

                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={handleRetry}
                                    className="flex-1 bg-[#5f259f] hover:bg-[#4a1d7c] text-white font-bold py-3 rounded-lg transition-colors"
                                >
                                    Try Again
                                </button>
                                <button
                                    onClick={() => {
                                        onClose();
                                        onFailure(error || 'Payment failed');
                                    }}
                                    className="flex-1 bg-bg-navy border border-surface-hover text-moonstone hover:text-white font-medium py-3 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
