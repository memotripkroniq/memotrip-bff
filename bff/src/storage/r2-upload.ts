import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client } from "./r2.client";
import { randomUUID } from "crypto";

export async function uploadTripMap(
    imageBase64: string
): Promise<string> {

    const buffer = Buffer.from(imageBase64, "base64");
    const fileName = `maps/trip_${randomUUID()}.png`;

    await r2Client.send(
        new PutObjectCommand({
            Bucket: process.env.R2_BUCKET!,
            Key: fileName,
            Body: buffer,
            ContentType: "image/png",
        })
    );

    return `${process.env.R2_PUBLIC_BASE_URL}/${fileName}`;
}
