import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client } from "./r2.client";
import { randomUUID } from "crypto";

export async function uploadTripMap(
    imageBase64: string
): Promise<string> {

    if (!process.env.R2_BUCKET) {
        throw new Error("R2_BUCKET is not defined");
    }

    if (!process.env.R2_PUBLIC_URL) {
        throw new Error("R2_PUBLIC_URL is not defined");
    }

    const buffer = Buffer.from(imageBase64, "base64");
    const fileName = `maps/trip_${randomUUID()}.png`;

    await r2Client.send(
        new PutObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: fileName,
            Body: buffer,
            ContentType: "image/png",
        })
    );

    // ✅ TADY BYLA CHYBA – MUSÍ BÝT R2_PUBLIC_URL
    return `${process.env.R2_PUBLIC_URL}/${fileName}`;
}
