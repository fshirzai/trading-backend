import { model, Schema } from "../../shared/model.js";
export const ProfileImage = model("ProfileImage", {
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  data: { type: Buffer, required: true, select: false },
  mime: { type: String, default: "image/webp" },
});
