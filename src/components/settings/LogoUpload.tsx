"use client";

import { useState, useRef, ChangeEvent } from "react";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LogoUploadProps {
    currentLogo?: string;
    onLogoChange: (base64Logo: string | null) => void;
    className?: string;
}

export function LogoUpload({ currentLogo, onLogoChange, className }: LogoUploadProps) {
    const [preview, setPreview] = useState<string | null>(currentLogo || null);
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = (file: File) => {
        if (!file.type.startsWith("image/")) {
            alert("Please select an image file");
            return;
        }

        // Max 1MB
        if (file.size > 1024 * 1024) {
            alert("Image size should be less than 1MB");
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            setPreview(base64);
            onLogoChange(base64);
        };
        reader.readAsDataURL(file);
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleFile(file);
        }
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        const file = e.dataTransfer.files?.[0];
        if (file) {
            handleFile(file);
        }
    };

    const removeLogo = () => {
        setPreview(null);
        onLogoChange(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    return (
        <div className={className}>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleChange}
                className="hidden"
            />

            {preview ? (
                <div className="relative inline-block">
                    <div className="w-40 h-24 rounded-lg border border-border bg-white flex items-center justify-center overflow-hidden">
                        <img
                            src={preview}
                            alt="Company Logo"
                            className="max-w-full max-h-full object-contain"
                        />
                    </div>
                    <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full"
                        onClick={removeLogo}
                    >
                        <X className="w-3 h-3" />
                    </Button>
                </div>
            ) : (
                <div
                    className={`
                        w-40 h-24 rounded-lg border-2 border-dashed
                        flex flex-col items-center justify-center gap-2 cursor-pointer
                        transition-colors
                        ${dragActive
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        }
                    `}
                    onClick={() => fileInputRef.current?.click()}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                >
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground text-center px-2">
                        Drop logo here or click to upload
                    </span>
                </div>
            )}

            <p className="text-xs text-muted-foreground mt-2">
                Max 1MB. PNG, JPG, or SVG recommended.
            </p>
        </div>
    );
}


